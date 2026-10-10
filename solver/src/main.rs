//! Batch flop solver for GTOtutor.
//!
//! Solves one preflop spot (ranges, pot, stacks, bet sizes from a spot JSON) on many flops and
//! writes the flop-street strategy for every hand to `<out>/<spot>/<flop>.json`. Re-running
//! skips flops that already have output, so a batch can be stopped and resumed at any time.

mod status;

use gtotutor_solver::nodes::{solve_to, walk_street, NodeOut};
use postflop_solver::*;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Deserialize, Serialize, Clone)]
struct Spot {
    name: String,
    description: String,
    /// Big blinds are multiplied by this to get the solver's integer chip units.
    chips_per_bb: i32,
    pot_bb: f64,
    stack_bb: f64,
    oop_range: String,
    ip_range: String,
    /// [bet sizes, raise sizes] per street, in postflop-solver's format (e.g. "33%", "3x").
    flop: [String; 2],
    turn: [String; 2],
    river: [String; 2],
}

#[derive(Serialize)]
struct FlopOut {
    spot: String,
    flop: String,
    /// How many of the 22,100 raw flops this canonical flop stands for.
    weight: u32,
    /// [bet sizes, raise sizes] per street this flop was solved with ("" = no raises).
    tree: [[String; 2]; 3],
    exploitability_pct_pot: f32,
    seconds: f64,
    hands: [Vec<String>; 2],
    /// Per hand at the flop root, in big blinds.
    ev_bb: [Vec<f32>; 2],
    equity: [Vec<f32>; 2],
    nodes: Vec<NodeOut>,
}

struct Args {
    spot: PathBuf,
    out: PathBuf,
    limit: usize,
    accuracy_pct: f32,
    max_iterations: u32,
    compress: bool,
    threads: usize,
    only: Option<String>,
    /// File listing the flops to solve (one per line or comma-separated), in that order.
    flop_list: Option<PathBuf>,
    memory_only: bool,
    status_port: Option<u16>,
}

fn parse_args() -> Args {
    let mut a = Args {
        spot: PathBuf::from("spots/btn_vs_bb_srp_100.json"),
        out: PathBuf::from("output"),
        limit: usize::MAX,
        accuracy_pct: 1.0,
        max_iterations: 1000,
        compress: false,
        threads: 0,
        only: None,
        flop_list: None,
        memory_only: false,
        status_port: None,
    };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let val = || argv.get(i + 1).cloned().unwrap_or_else(|| die(&format!("missing value for {}", argv[i])));
        match argv[i].as_str() {
            "--spot" => a.spot = val().into(),
            "--out" => a.out = val().into(),
            "--limit" => a.limit = val().parse().unwrap_or_else(|_| die("--limit must be a number")),
            "--accuracy" => a.accuracy_pct = val().parse().unwrap_or_else(|_| die("--accuracy must be a number")),
            "--max-iterations" => a.max_iterations = val().parse().unwrap_or_else(|_| die("--max-iterations must be a number")),
            "--threads" => a.threads = val().parse().unwrap_or_else(|_| die("--threads must be a number")),
            "--flop" => a.only = Some(val()),
            "--flops" => a.flop_list = Some(val().into()),
            "--memory" => {
                a.memory_only = true;
                i += 1;
                continue;
            }
            "--status-port" => a.status_port = Some(val().parse().unwrap_or_else(|_| die("--status-port must be a port number"))),
            "--compress" => {
                a.compress = true;
                i += 1;
                continue;
            }
            "--help" | "-h" => {
                println!("{}", include_str!("../USAGE.txt"));
                std::process::exit(0);
            }
            other => die(&format!("unknown argument {other} (see --help)")),
        }
        i += 2;
    }
    a
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(2);
}

const RANKS: &[u8] = b"23456789TJQKA";
const SUITS: &[u8] = b"cdhs";

fn card_str(c: u8) -> String {
    format!("{}{}", RANKS[(c / 4) as usize] as char, SUITS[(c % 4) as usize] as char)
}

/// All strategically distinct flops (1,755) with how many raw flops each represents, in a fixed
/// shuffled order so any prefix of the list is a representative random sample.
fn canonical_flops() -> Vec<([u8; 3], u32)> {
    let perms: Vec<[u8; 4]> = {
        let mut v = Vec::new();
        for a in 0..4u8 {
            for b in 0..4u8 {
                for c in 0..4u8 {
                    for d in 0..4u8 {
                        let p = [a, b, c, d];
                        if (0..4).all(|i| (0..4).filter(|&j| p[j] == i).count() == 1) {
                            v.push(p);
                        }
                    }
                }
            }
        }
        v
    };
    let mut counts = std::collections::BTreeMap::<[u8; 3], u32>::new();
    for x in 0..52u8 {
        for y in (x + 1)..52 {
            for z in (y + 1)..52 {
                let key = perms
                    .iter()
                    .map(|p| {
                        let mut f = [x, y, z].map(|c| (c / 4) * 4 + p[(c % 4) as usize]);
                        f.sort_unstable_by(|a, b| b.cmp(a));
                        f
                    })
                    .max()
                    .unwrap();
                *counts.entry(key).or_default() += 1;
            }
        }
    }
    let mut flops: Vec<_> = counts.into_iter().collect();
    // Deterministic shuffle (xorshift), so every machine solves flops in the same order.
    let mut s: u64 = 0x9E37_79B9_7F4A_7C15;
    for i in (1..flops.len()).rev() {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        flops.swap(i, (s % (i as u64 + 1)) as usize);
    }
    flops
}

fn build_game(spot: &Spot, flop: &str) -> Result<PostFlopGame, String> {
    let card_config = CardConfig {
        range: [spot.oop_range.parse()?, spot.ip_range.parse()?],
        flop: flop_from_str(flop)?,
        turn: NOT_DEALT,
        river: NOT_DEALT,
    };
    let sizes = |s: &[String; 2]| BetSizeOptions::try_from((s[0].as_str(), s[1].as_str()));
    let (f, t, r) = (sizes(&spot.flop)?, sizes(&spot.turn)?, sizes(&spot.river)?);
    let chips = |bb: f64| (bb * spot.chips_per_bb as f64).round() as i32;
    let tree = ActionTree::new(TreeConfig {
        initial_state: BoardState::Flop,
        starting_pot: chips(spot.pot_bb),
        effective_stack: chips(spot.stack_bb),
        flop_bet_sizes: [f.clone(), f],
        turn_bet_sizes: [t.clone(), t],
        river_bet_sizes: [r.clone(), r],
        add_allin_threshold: 1.5,  // add an all-in option when the biggest bet is <= 1.5x pot
        force_allin_threshold: 0.15, // bets that leave <= 0.15 SPR become all-in
        merging_threshold: 0.1,
        ..Default::default()
    })?;
    PostFlopGame::with_config(card_config, tree)
}

fn solve_flop(spot: &Spot, flop: &str, weight: u32, args: &Args, tracker: &mut status::Tracker) -> Result<FlopOut, String> {
    let start = Instant::now();
    let mut game = build_game(spot, flop)?;
    game.allocate_memory(args.compress);
    let (exploitability_pct_pot, _) = solve_to(&mut game, args.accuracy_pct, args.max_iterations, |t, e| tracker.iteration(t, e));

    game.back_to_root();
    game.cache_normalized_weights();
    let per_bb = |v: Vec<f32>| v.into_iter().map(|x| (x / spot.chips_per_bb as f32 * 100.0).round() / 100.0).collect();
    let round3 = |v: Vec<f32>| v.into_iter().map(|x| (x * 1000.0).round() / 1000.0).collect();
    let hands = [0, 1].map(|p| holes_to_strings(game.private_cards(p)).unwrap());
    let ev_bb = [per_bb(game.expected_values(0)), per_bb(game.expected_values(1))];
    let equity = [round3(game.equity(0)), round3(game.equity(1))];
    let mut nodes = Vec::new();
    walk_street(&mut game, &[], &mut Vec::new(), spot.chips_per_bb, &mut nodes, &mut Vec::new());

    Ok(FlopOut {
        spot: spot.name.clone(),
        flop: flop.to_string(),
        weight,
        tree: [spot.flop.clone(), spot.turn.clone(), spot.river.clone()],
        exploitability_pct_pot,
        seconds: start.elapsed().as_secs_f64(),
        hands,
        ev_bb,
        equity,
        nodes,
    })
}

fn memory_gb(spot: &Spot, flop: &str) -> Result<(f64, f64), String> {
    let (raw, compressed) = build_game(spot, flop)?.memory_usage();
    let gb = |b: u64| b as f64 / (1u64 << 30) as f64;
    Ok((gb(raw), gb(compressed)))
}

fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, data)?;
    std::fs::rename(tmp, path)
}

fn main() {
    let args = parse_args();
    if args.threads > 0 {
        rayon::ThreadPoolBuilder::new().num_threads(args.threads).build_global().unwrap();
    }
    let spot: Spot = serde_json::from_str(
        &std::fs::read_to_string(&args.spot).unwrap_or_else(|e| die(&format!("cannot read {}: {e}", args.spot.display()))),
    )
    .unwrap_or_else(|e| die(&format!("bad spot file: {e}")));
    let dir = args.out.join(&spot.name);
    std::fs::create_dir_all(&dir).unwrap_or_else(|e| die(&format!("cannot create {}: {e}", dir.display())));

    let mut flops: Vec<(String, u32)> = canonical_flops()
        .into_iter()
        .map(|(f, w)| (f.iter().map(|&c| card_str(c)).collect::<String>(), w))
        .collect();
    if let Some(only) = &args.only {
        let target = flop_from_str(only).unwrap_or_else(|e| die(&e));
        flops = vec![(target.iter().map(|&c| card_str(c)).collect(), 0)];
    }
    if let Some(list) = &args.flop_list {
        let text = std::fs::read_to_string(list).unwrap_or_else(|e| die(&format!("cannot read {}: {e}", list.display())));
        let weights: std::collections::HashMap<String, u32> = flops.iter().cloned().collect();
        flops = text
            .split(|c: char| c == ',' || c.is_whitespace())
            .filter(|f| !f.is_empty())
            .map(|f| {
                let w = *weights
                    .get(f)
                    .unwrap_or_else(|| die(&format!("{f} is not a canonical flop name (use the names the solver writes, e.g. Ks7h2d)")));
                (f.to_string(), w)
            })
            .collect();
    }
    flops.truncate(args.limit);

    let (raw, compressed) = memory_gb(&spot, &flops[0].0).unwrap_or_else(|e| die(&e));
    println!(
        "spot {} | {} flops | memory per solve ~{raw:.1} GB ({compressed:.1} GB with --compress) | using {}",
        spot.name,
        flops.len(),
        if args.compress { "compressed" } else { "uncompressed" }
    );
    if args.memory_only {
        return;
    }
    std::fs::write(dir.join("_spot.json"), serde_json::to_vec_pretty(&spot).unwrap()).ok();

    let already_done = flops.iter().filter(|(f, _)| dir.join(format!("{f}.json")).exists()).count();
    let mut tracker = status::Tracker::new(
        status::Status {
            spot: spot.name.clone(),
            total_flops: flops.len(),
            done_flops: already_done,
            max_iterations: args.max_iterations,
            target_pct_pot: args.accuracy_pct,
            ..Default::default()
        },
        dir.join("_progress.json"),
    );
    if let Some(port) = args.status_port {
        match tracker.serve(port) {
            Ok(url) => println!("status page: {url} (open it from any device on this Wi-Fi)"),
            Err(e) => eprintln!("could not start the status page on port {port}: {e}"),
        }
    }
    if already_done > 0 {
        println!("{already_done} flops already solved; resuming");
    }

    for (flop, weight) in &flops {
        let path = dir.join(format!("{flop}.json"));
        if path.exists() {
            continue;
        }
        tracker.start_flop(flop);
        match solve_flop(&spot, flop, *weight, &args, &mut tracker) {
            Ok(result) => {
                write_atomic(&path, &serde_json::to_vec(&result).unwrap()).unwrap_or_else(|e| die(&format!("write failed: {e}")));
                tracker.finish_flop(flop, Some((result.seconds, result.exploitability_pct_pot)));
            }
            Err(e) => {
                eprintln!("\n{flop}: {e}");
                tracker.finish_flop(flop, None);
            }
        }
    }
    tracker.finish();
    println!("finished: all {} flops of {} are done (see {})", flops.len(), spot.name, dir.display());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_flops_cover_every_raw_flop_once() {
        let flops = canonical_flops();
        assert_eq!(flops.len(), 1755);
        assert_eq!(flops.iter().map(|(_, w)| w).sum::<u32>(), 22100);
    }
}

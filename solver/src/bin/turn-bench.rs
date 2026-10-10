//! Times live turn solves (docs/postflop-plan.md, step 7.1): builds the turn-start ranges from a
//! stored flop solve and a flop line, solves the turn and every river, and prints time, memory and
//! output size per bet-size tree. Run from solver/:
//!
//!   cargo run --release --bin turn-bench -- --spot spots/preflop-v9/btn_vs_bb_srp_100.json \
//!     --flop-file output/preflop-v9/btn_vs_bb_srp_100/Ks7h2d.json --line 0.0 --turn 9c --trees a,b,c --threads 6

use gtotutor_solver::live::{solve, turn_start, FlopFileIn, LiveRequest};
use postflop_solver::Range;
use std::path::PathBuf;

/// Turn and river trees to compare: [bet sizes, raise sizes] per street.
fn tree(name: &str, spot_turn: &[String; 2], spot_river: &[String; 2]) -> ([String; 2], [String; 2]) {
    let s = |a: &str, b: &str| [a.to_string(), b.to_string()];
    match name {
        // The flop solves' own later streets: one size, no raises.
        "a" => (spot_turn.clone(), spot_river.clone()),
        "b" => (s("33%,75%", ""), s("50%,100%", "")),
        "c" => (s("33%,75%,125%", "3x"), s("50%,100%,a", "3x")),
        // (c) without raises, and (b) with one raise.
        "d" => (s("33%,75%,125%", ""), s("50%,100%,a", "")),
        "e" => (s("33%,75%", "3x"), s("50%,100%", "3x")),
        other => die(&format!("unknown tree {other} (a to e)")),
    }
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(2);
}

fn main() {
    let mut spot_path = None;
    let mut flop_path = None;
    let mut line = String::new();
    let mut turn = None;
    let mut trees = "a".to_string();
    let mut threads = 0usize;
    let mut accuracy = 1.0f32;
    let mut write: Option<PathBuf> = None;
    let mut rivers: Vec<String> = Vec::new();
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let val = argv.get(i + 1).cloned().unwrap_or_else(|| die(&format!("missing value for {}", argv[i])));
        match argv[i].as_str() {
            "--spot" => spot_path = Some(PathBuf::from(val)),
            "--flop-file" => flop_path = Some(PathBuf::from(val)),
            "--line" => line = val,
            "--turn" => turn = Some(val),
            "--trees" => trees = val,
            "--threads" => threads = val.parse().unwrap_or_else(|_| die("--threads must be a number")),
            "--accuracy" => accuracy = val.parse().unwrap_or_else(|_| die("--accuracy must be a number")),
            "--rivers" => rivers = val.split(',').map(String::from).collect(),
            "--write" => write = Some(PathBuf::from(val)),
            other => die(&format!("unknown argument {other}")),
        }
        i += 2;
    }
    if threads > 0 {
        rayon::ThreadPoolBuilder::new().num_threads(threads).build_global().unwrap();
    }
    let spot_path = spot_path.unwrap_or_else(|| die("--spot is required"));
    let flop_path = flop_path.unwrap_or_else(|| die("--flop-file is required"));
    let turn = turn.unwrap_or_else(|| die("--turn is required"));
    let spot: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&spot_path).unwrap_or_else(|e| die(&e.to_string()))).unwrap();
    let flop: FlopFileIn = serde_json::from_str(&std::fs::read_to_string(&flop_path).unwrap_or_else(|e| die(&e.to_string()))).unwrap();
    let range = |k: &str| -> Range { spot[k].as_str().unwrap().parse().unwrap_or_else(|e: String| die(&e)) };
    let (oop, ip) = (range("oop_range"), range("ip_range"));
    let line: Vec<usize> = line.split('.').filter(|s| !s.is_empty()).map(|s| s.parse().unwrap_or_else(|_| die("bad --line"))).collect();
    let (ranges, pot_bb, stack_bb) =
        turn_start(&flop, [&oop, &ip], &line, spot["pot_bb"].as_f64().unwrap(), spot["stack_bb"].as_f64().unwrap()).unwrap_or_else(|e| die(&e));
    let strs = |k: &str| -> [String; 2] { [spot[k][0].as_str().unwrap().to_string(), spot[k][1].as_str().unwrap().to_string()] };
    let (spot_turn, spot_river) = (strs("turn"), strs("river"));
    let mut board: Vec<String> = flop.flop.as_bytes().chunks(2).map(|c| String::from_utf8(c.to_vec()).unwrap()).collect();
    board.push(turn);
    let live = |p: usize| ranges[p].iter().filter(|&&w| w > 0.0).count();

    println!(
        "{} {} line {:?} | pot {pot_bb}bb, stacks {stack_bb}bb | hands live: OOP {}, IP {} | {} threads",
        spot["name"].as_str().unwrap(),
        board.join(""),
        line,
        live(0),
        live(1),
        rayon::current_num_threads()
    );
    for t in trees.split(',') {
        let (turn_sizes, river_sizes) = tree(t, &spot_turn, &spot_river);
        let req = LiveRequest {
            board: board.clone(),
            hands: flop.hands.clone(),
            ranges: ranges.clone(),
            pot_bb,
            stack_bb,
            chips_per_bb: spot["chips_per_bb"].as_i64().unwrap() as i32,
            turn: turn_sizes.clone(),
            river: river_sizes.clone(),
            river_cards: rivers.clone(),
            accuracy_pct: accuracy,
            max_iterations: 1000,
        };
        if let Some(path) = &write {
            std::fs::write(path.with_extension(format!("{t}.request.json")), serde_json::to_vec(&req).unwrap()).unwrap();
        }
        match solve(&req) {
            Ok(out) => {
                let json = serde_json::to_vec(&out).unwrap();
                let river_nodes: usize = out.rivers.iter().map(|r| r.nodes.len()).sum();
                let biggest_river = out.rivers.iter().map(|r| serde_json::to_vec(r).unwrap().len()).max().unwrap_or(0);
                let turn_only = json.len() - out.rivers.iter().map(|r| serde_json::to_vec(r).unwrap().len()).sum::<usize>();
                println!(
                    "tree {t} (turn {:?}, river {:?}): solve {:.2}s ({} iterations, {:.2}% pot) + export {:.2}s | memory {:.0} MB | turn nodes {} ({:.0} KB), river nodes {} over {} cards (largest river entry {:.0} KB, all {:.1} MB)",
                    turn_sizes,
                    river_sizes,
                    out.solve_seconds,
                    out.iterations,
                    out.exploitability_pct_pot,
                    out.export_seconds,
                    out.memory_mb,
                    out.nodes.len(),
                    turn_only as f64 / 1024.0,
                    river_nodes,
                    out.rivers.len(),
                    biggest_river as f64 / 1024.0,
                    json.len() as f64 / (1 << 20) as f64
                );
                if let Some(path) = &write {
                    std::fs::write(path.with_extension(format!("{t}.json")), &json).unwrap();
                }
            }
            Err(e) => println!("tree {t}: error: {e}"),
        }
    }
}

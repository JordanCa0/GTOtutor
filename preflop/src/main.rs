//! Simplified 6-max preflop solver for GTOtutor.
//!
//! Solves the preflop game the app's hand engine plays (same sizes, same chart nodes) with
//! discounted CFR over the 169 hand classes. Postflop play isn't solved: a hand that sees a flop
//! gets pot × equity × a realization factor (see realization.rs). Writes a ChartSet JSON that the
//! API loads (`apps/api/src/charts/solvedCharts.ts`).

mod cards;
mod cfr;
mod equity;
mod game;
mod realization;

use cards::{all_classes, class_probs, NUM_CLASSES as H};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::time::Instant;

struct Args {
    iterations: u32,
    samples: u32,
    realization: Option<PathBuf>,
    version: String,
    out: Option<PathBuf>,
    report_every: u32,
    /// Percent: while training, UTG–BTN open-limp at least this often (see Solver::set_action_floor).
    limp_floor: f64,
}

fn die(msg: &str) -> ! {
    eprintln!("error: {msg}");
    std::process::exit(2);
}

fn parse_args() -> Args {
    let mut a = Args { iterations: 2000, samples: 20_000, realization: None, version: "preflop-v1".into(), out: None, report_every: 250, limp_floor: 1.0 };
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let val = || argv.get(i + 1).cloned().unwrap_or_else(|| die(&format!("missing value for {}", argv[i])));
        let num = |s: String| s.parse::<u32>().unwrap_or_else(|_| die(&format!("{} must be a number", argv[i])));
        match argv[i].as_str() {
            "--iterations" => a.iterations = num(val()),
            "--samples" => a.samples = num(val()),
            "--realization" => a.realization = Some(val().into()),
            "--version" => a.version = val(),
            "--out" => a.out = Some(val().into()),
            "--report-every" => a.report_every = num(val()).max(1),
            "--limp-floor" => a.limp_floor = val().parse::<f64>().ok().filter(|p| (0.0..50.0).contains(p)).unwrap_or_else(|| die("--limp-floor must be a percent from 0 to 50")),
            "--help" | "-h" => {
                println!(
                    "gtotutor-preflop (run from the preflop/ folder)\n\n  cargo run --release -- [options]\n\n  \
                     --iterations <n>     CFR iterations (default 2000)\n  \
                     --samples <n>        Monte Carlo samples per class matchup for the equity table (default 20000; cached)\n  \
                     --realization <file> measured realization factors from calibrateRealization.ts (default: built-in model)\n  \
                     --version <name>     chart version written into the output (default preflop-v1)\n  \
                     --out <file>         output path (default charts/<version>.json)\n  \
                     --report-every <n>   print exploitability every n iterations (default 250)
                       --limp-floor <pct>   while training, UTG-BTN open-limp at least this often, so the lines after a limp
                         get real strategies; the charts show the unforced strategy (default 1, 0 = off)"
                );
                std::process::exit(0);
            }
            other => die(&format!("unknown argument {other} (see --help)")),
        }
        i += 2;
    }
    a
}

fn round(x: f64, places: i32) -> f64 {
    let m = 10f64.powi(places);
    (x * m).round() / m
}

fn main() {
    let args = parse_args();
    let classes = all_classes();
    let probs = class_probs(&classes);
    let eq = equity::EquityTable::load_or_compute(&classes, args.samples, &PathBuf::from(format!("cache/equity-{}.json", args.samples)));

    let tree = game::build_six_max();
    let file: Option<realization::RealizationFile> = args.realization.as_ref().map(|p| {
        serde_json::from_str(&std::fs::read_to_string(p).unwrap_or_else(|e| die(&format!("cannot read {}: {e}", p.display()))))
            .unwrap_or_else(|e| die(&format!("bad realization file: {e}")))
    });
    let model = realization::Model::new(&tree.real_keys, &classes, file.as_ref());
    println!(
        "tree: {} nodes, {} info sets ({} exported) | realization: {}",
        tree.nodes.len(),
        tree.infosets.len(),
        tree.infosets.iter().filter(|i| i.export).count(),
        args.realization.as_ref().map(|p| p.display().to_string()).unwrap_or_else(|| "built-in model".into())
    );

    let mut solver = cfr::Solver::new(&tree, &eq, probs.clone(), model);
    if args.limp_floor > 0.0 {
        let mut floored = 0;
        for (i, info) in tree.infosets.iter().enumerate() {
            let limp = info.actions.iter().position(|a| a.id == "call");
            if let (true, false, Some(a)) = (info.key.contains("|RFI|"), info.key.ends_with("|SB"), limp) {
                solver.set_action_floor(i, a, args.limp_floor / 100.0);
                floored += 1;
            }
        }
        println!("limp floor: {}% while training, at {floored} first-in nodes", args.limp_floor);
    }
    let start = Instant::now();
    let mut nash_conv = f64::NAN;
    // Realization depends on the ranges, so it follows the average strategy every 50 iterations,
    // then stays fixed for the last fifth so the final strategy solves one fixed game.
    let freeze_at = args.iterations * 4 / 5;
    for t in 1..=args.iterations {
        solver.iterate();
        if t % 50 == 0 && t <= freeze_at {
            solver.refresh_realization();
        }
        if t % args.report_every == 0 || t == args.iterations {
            nash_conv = solver.local_nash_conv();
            println!("iteration {t:5} | {:6.1}s | exploitability {:.2} mbb/hand per player", start.elapsed().as_secs_f64(), nash_conv / 6.0 * 1000.0);
        }
    }
    let full_history = solver.nash_conv();
    println!("  against a best response that sees the whole action history: {:.1} mbb/hand per player (what the chart abstraction gives up)", full_history / 6.0 * 1000.0);
    let values = solver.values();
    let evs = solver.action_evs();

    let mut nodes = Vec::new();
    // Every info set is exported, "|nocall" variants included: the engine uses those when someone
    // has already called.
    for (i, info) in tree.infosets.iter().enumerate() {
        let avg = solver.average_strategy(i);
        let n = info.actions.len();
        let mut strategy = Map::new();
        let mut ev = Map::new();
        let mut reach = Map::new();
        for (h, c) in classes.iter().enumerate() {
            strategy.insert(c.name(), json!((0..n).map(|a| round(avg[a * H + h], 3)).collect::<Vec<_>>()));
            reach.insert(c.name(), json!(round(evs.reach[i][h], 6)));
            ev.insert(c.name(), json!((0..n).map(|a| round(evs.ev[i][a * H + h], 3)).collect::<Vec<_>>()));
        }
        nodes.push(json!({
            "nodeKey": info.key,
            "label": info.label,
            "actions": info.actions.iter().map(|a| json!({ "id": a.id, "label": a.label, "toBb": a.to_bb })).collect::<Vec<_>>(),
            "strategy": strategy,
            "ev": ev,
            "reach": reach,
        }));
    }

    // A quick look at the result: how often each seat opens.
    for (i, info) in tree.infosets.iter().enumerate() {
        if info.export && info.key.contains("|RFI|") {
            let avg = solver.average_strategy(i);
            let shares: Vec<String> = info
                .actions
                .iter()
                .enumerate()
                .map(|(a, act)| format!("{} {:.1}%", act.id, (0..H).map(|h| probs[h] * avg[a * H + h]).sum::<f64>() * 100.0))
                .collect();
            println!("  {:28} {}", info.key, shares.join(", "));
        }
    }

    let out_path = args.out.clone().unwrap_or_else(|| PathBuf::from(format!("charts/{}.json", args.version)));
    let doc = json!({
        "version": args.version,
        "dataSource": {
            "kind": "solver",
            "note": "Simplified preflop solver: postflop value is estimated from equity × realization, flops are heads-up only, and card removal between players is ignored.",
        },
        "meta": {
            "iterations": args.iterations,
            "equitySamples": args.samples,
            "exploitabilityMbbPerPlayer": round(nash_conv / 6.0 * 1000.0, 2),
            "fullHistoryExploitabilityMbbPerPlayer": round(full_history / 6.0 * 1000.0, 2),
            "realization": args.realization.as_ref().map(|p| p.display().to_string()),
            "limpFloorPct": args.limp_floor,
            "seatValuesBb": values.iter().zip(game::POSITIONS).map(|(v, p)| (p.to_string(), json!(round(*v, 4)))).collect::<Map<String, Value>>(),
            "evUnits": "bb, net result from the start of the hand",
        },
        "nodes": nodes,
    });
    if let Some(dir) = out_path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    std::fs::write(&out_path, serde_json::to_string(&doc).unwrap()).unwrap_or_else(|e| die(&format!("write failed: {e}")));
    println!("wrote {} ({} chart nodes) in {:.1}s", out_path.display(), doc["nodes"].as_array().unwrap().len(), start.elapsed().as_secs_f64());
}

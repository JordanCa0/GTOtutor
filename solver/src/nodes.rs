//! Decision nodes as written to JSON: shared by the batch flop solver and live turn/river solves.

use postflop_solver::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct NodeOut {
    /// Action indexes from the street's first decision (same order as `actions` at each parent).
    pub history: Vec<usize>,
    /// 0 = OOP, 1 = IP.
    pub player: usize,
    pub actions: Vec<String>,
    /// Per action, per hand of `player` (same order as `hands`): frequency in permille.
    pub strategy: Vec<Vec<u16>>,
    /// Per hand of `player`: how much of it reaches this node, counted against the opponent's
    /// hands that also reach it (0 = never gets here). Sums are equal for both players at a node.
    pub weights: Vec<f32>,
    /// Per hand of `player`: equity against the opponent's range at this node.
    pub equity: Vec<f32>,
    /// Per action, per hand of `player`: expected value in big blinds.
    pub ev_bb: Vec<Vec<f32>>,
}

pub fn action_label(a: &Action, chips_per_bb: i32) -> String {
    let bb = |x: i32| format!("{}", (x as f64 / chips_per_bb as f64 * 100.0).round() / 100.0);
    match a {
        Action::Fold => "fold".into(),
        Action::Check => "check".into(),
        Action::Call => "call".into(),
        Action::Bet(x) => format!("bet {}", bb(*x)),
        Action::Raise(x) => format!("raise {}", bb(*x)),
        Action::AllIn(x) => format!("allin {}", bb(*x)),
        other => format!("{other:?}"),
    }
}

/// Records every decision on one street, starting after `prefix` (the game history up to the
/// street's first decision). Lines that end the street with the next card to come are pushed to
/// `ends`, as histories relative to the street; terminal nodes (fold, showdown) are not.
pub fn walk_street(
    game: &mut PostFlopGame,
    prefix: &[usize],
    history: &mut Vec<usize>,
    chips_per_bb: i32,
    out: &mut Vec<NodeOut>,
    ends: &mut Vec<Vec<usize>>,
) {
    let full: Vec<usize> = prefix.iter().chain(history.iter()).copied().collect();
    game.apply_history(&full);
    if game.is_terminal_node() {
        return;
    }
    if game.is_chance_node() {
        ends.push(history.clone());
        return;
    }
    let player = game.current_player();
    let actions = game.available_actions();
    let n = game.private_cards(player).len();
    let strat = game.strategy();
    game.cache_normalized_weights();
    // Hands that never reach a node can come back as NaN; their weight is 0, so 0 is safe.
    let round = |x: f32, scale: f32| if x.is_finite() { (x * scale).round() / scale } else { 0.0 };
    let evs = game.expected_values_detail(player);
    out.push(NodeOut {
        history: history.clone(),
        player,
        actions: actions.iter().map(|a| action_label(a, chips_per_bb)).collect(),
        strategy: (0..actions.len())
            .map(|a| (0..n).map(|h| (strat[a * n + h] * 1000.0).round() as u16).collect())
            .collect(),
        weights: game.normalized_weights(player).iter().map(|&w| round(w, 1000.0)).collect(),
        equity: game.equity(player).into_iter().map(|e| round(e, 1000.0)).collect(),
        ev_bb: (0..actions.len())
            .map(|a| (0..n).map(|h| round(evs[a * n + h] / chips_per_bb as f32, 100.0)).collect())
            .collect(),
    });
    for i in 0..actions.len() {
        history.push(i);
        walk_street(game, prefix, history, chips_per_bb, out, ends);
        history.pop();
    }
}

/// Runs the solver until it reaches `accuracy_pct` of the starting pot (or `max_iterations`), calling
/// `progress(iteration, exploitability % of pot when measured)` as it goes. Returns the final
/// exploitability as % of pot and the iterations run.
pub fn solve_to(game: &mut PostFlopGame, accuracy_pct: f32, max_iterations: u32, mut progress: impl FnMut(u32, Option<f32>)) -> (f32, u32) {
    let pot = game.tree_config().starting_pot as f32;
    // Same loop as postflop_solver::solve, unrolled so progress can be reported every iteration.
    let target = pot * accuracy_pct / 100.0;
    let mut exploitability = compute_exploitability(game);
    progress(0, Some(exploitability / pot * 100.0));
    let mut done = 0;
    for t in 0..max_iterations {
        if exploitability <= target {
            break;
        }
        solve_step(game, t);
        done = t + 1;
        let measured = (t + 1) % 10 == 0 || t + 1 == max_iterations;
        if measured {
            exploitability = compute_exploitability(game);
        }
        progress(t + 1, measured.then(|| exploitability / pot * 100.0));
    }
    finalize(game);
    (exploitability / pot * 100.0, done)
}

//! Live turn and river solves (the solver service; see docs/postflop-plan.md, "Live turn and river
//! solving"). A request carries the board, both ranges at the start of the street, the pot, the
//! stacks and the bet sizes; the result holds every turn decision and, for every river card, every
//! river decision, in the same node format as the flop files.

use crate::nodes::{solve_to, walk_street, NodeOut};
use postflop_solver::*;
use serde::{Deserialize, Serialize};
use std::time::Instant;

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LiveRequest {
    /// Flop and turn (a turn solve), or flop, turn and river (a river solve), e.g. ["Kh", "7d", "2c", "9s"].
    pub board: Vec<String>,
    /// Per player (0 = OOP, 1 = IP): hands like "AsKh" and their weights (0-1), in the same order.
    pub hands: [Vec<String>; 2],
    pub ranges: [Vec<f32>; 2],
    pub pot_bb: f64,
    /// Effective stack behind at the start of the street.
    pub stack_bb: f64,
    pub chips_per_bb: i32,
    /// [bet sizes, raise sizes] in postflop-solver's format; "" = no raises.
    pub turn: [String; 2],
    pub river: [String; 2],
    /// Turn solves: river cards whose river decisions to return (the server deals the river in
    /// advance). Empty = every river card, which can be hundreds of MB with several sizes.
    #[serde(default)]
    pub river_cards: Vec<String>,
    #[serde(default = "default_accuracy")]
    pub accuracy_pct: f32,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u32,
}

fn default_accuracy() -> f32 {
    1.0
}
fn default_max_iterations() -> u32 {
    1000
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiverOut {
    /// The turn line (action indexes) that led to this river.
    pub turn_line: Vec<usize>,
    pub card: String,
    pub nodes: Vec<NodeOut>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveOut {
    pub board: Vec<String>,
    /// Per player: the hands the node strategies refer to (hands that touch the board are left out).
    pub hands: [Vec<String>; 2],
    pub exploitability_pct_pot: f32,
    pub iterations: u32,
    pub solve_seconds: f64,
    pub export_seconds: f64,
    pub memory_mb: f64,
    /// Decisions on the first street of the solve (the turn, or the river for a river solve).
    pub nodes: Vec<NodeOut>,
    /// Turn solves only: every river decision, per turn line and river card.
    pub rivers: Vec<RiverOut>,
}

fn card_name(c: Card) -> String {
    card_to_string(c).unwrap_or_default()
}

fn parse_hand(h: &str) -> Result<(Card, Card), String> {
    if h.len() != 4 {
        return Err(format!("bad hand {h}"));
    }
    Ok((card_from_str(&h[0..2])?, card_from_str(&h[2..4])?))
}

pub fn build_game(req: &LiveRequest) -> Result<PostFlopGame, String> {
    if req.board.len() != 4 && req.board.len() != 5 {
        return Err("board must have 4 (turn) or 5 (river) cards".into());
    }
    let cards: Vec<Card> = req.board.iter().map(|c| card_from_str(c)).collect::<Result<_, _>>()?;
    let mut range = [Range::new(), Range::new()];
    for p in 0..2 {
        if req.hands[p].len() != req.ranges[p].len() {
            return Err(format!("player {p}: {} hands but {} weights", req.hands[p].len(), req.ranges[p].len()));
        }
        let hands: Vec<(Card, Card)> = req.hands[p].iter().map(|h| parse_hand(h)).collect::<Result<_, _>>()?;
        let weights: Vec<f32> = req.ranges[p].iter().map(|w| w.clamp(0.0, 1.0)).collect();
        range[p] = Range::from_hands_weights(&hands, &weights)?;
    }
    let card_config = CardConfig {
        range,
        flop: [cards[0], cards[1], cards[2]],
        turn: cards[3],
        river: if cards.len() == 5 { cards[4] } else { NOT_DEALT },
    };
    let sizes = |s: &[String; 2]| BetSizeOptions::try_from((s[0].as_str(), s[1].as_str()));
    let (t, r) = (sizes(&req.turn)?, sizes(&req.river)?);
    let chips = |bb: f64| (bb * req.chips_per_bb as f64).round() as i32;
    let tree = ActionTree::new(TreeConfig {
        initial_state: if cards.len() == 5 { BoardState::River } else { BoardState::Turn },
        starting_pot: chips(req.pot_bb),
        effective_stack: chips(req.stack_bb),
        turn_bet_sizes: [t.clone(), t],
        river_bet_sizes: [r.clone(), r],
        // Same thresholds as the flop solves (main.rs).
        add_allin_threshold: 1.5,
        force_allin_threshold: 0.15,
        merging_threshold: 0.1,
        ..Default::default()
    })?;
    PostFlopGame::with_config(card_config, tree)
}

pub fn solve(req: &LiveRequest) -> Result<LiveOut, String> {
    let start = Instant::now();
    let mut game = build_game(req)?;
    let (raw, _) = game.memory_usage();
    game.allocate_memory(false);
    let (exploitability, iterations) = solve_to(&mut game, req.accuracy_pct, req.max_iterations, |_, _| {});
    let solve_seconds = start.elapsed().as_secs_f64();

    let export = Instant::now();
    game.back_to_root();
    let hands = [0, 1].map(|p| holes_to_strings(game.private_cards(p)).unwrap());
    let mut nodes = Vec::new();
    let mut ends = Vec::new();
    walk_street(&mut game, &[], &mut Vec::new(), req.chips_per_bb, &mut nodes, &mut ends);
    let wanted: Vec<Card> = req.river_cards.iter().map(|c| card_from_str(c)).collect::<Result<_, _>>()?;
    let mut rivers = Vec::new();
    for line in ends {
        game.apply_history(&line);
        let possible = game.possible_cards();
        for card in (0..52u8).filter(|c| possible & (1u64 << c) != 0 && (wanted.is_empty() || wanted.contains(c))) {
            let prefix: Vec<usize> = line.iter().copied().chain([card as usize]).collect();
            let mut river_nodes = Vec::new();
            walk_street(&mut game, &prefix, &mut Vec::new(), req.chips_per_bb, &mut river_nodes, &mut Vec::new());
            rivers.push(RiverOut { turn_line: line.clone(), card: card_name(card), nodes: river_nodes });
        }
    }
    Ok(LiveOut {
        board: req.board.clone(),
        hands,
        exploitability_pct_pot: exploitability,
        iterations,
        solve_seconds,
        export_seconds: export.elapsed().as_secs_f64(),
        memory_mb: raw as f64 / (1u64 << 20) as f64,
        nodes,
        rivers,
    })
}

// ---------------------------------------------------------------------------------------------
// Turn-start ranges from a stored flop solve. The API will do the same in TypeScript; this copy
// is for benchmarks and for testing the formula against the solver's own numbers.

#[derive(Deserialize)]
pub struct FlopNodeIn {
    pub history: Vec<usize>,
    pub player: usize,
    pub actions: Vec<String>,
    pub strategy: Vec<Vec<u16>>,
    #[serde(default)]
    pub weights: Vec<f32>,
}

#[derive(Deserialize)]
pub struct FlopFileIn {
    pub flop: String,
    pub hands: [Vec<String>; 2],
    pub nodes: Vec<FlopNodeIn>,
}

/// The state at the start of the turn after `line` (flop action indexes): each player's hands and
/// reach (preflop range weight x how often the hand took each action on the line), and the pot and
/// stacks. Errors if the line doesn't reach the turn (a fold, or a decision still to come).
///
/// The flop files' `weights` can't be used for this: they are reach times the opponent's
/// card-removal mass (postflop-solver's "normalized weights"), so blockers would count twice.
pub fn turn_start(
    flop: &FlopFileIn,
    preflop: [&Range; 2],
    line: &[usize],
    pot_bb: f64,
    stack_bb: f64,
) -> Result<([Vec<f32>; 2], f64, f64), String> {
    let mut reach: [Vec<f32>; 2] = [0, 1].map(|p| {
        flop.hands[p]
            .iter()
            .map(|h| parse_hand(h).map(|(a, b)| preflop[p].get_weight_by_cards(a, b)).unwrap_or(0.0))
            .collect()
    });
    let mut street = [0.0f64; 2];
    for k in 0..line.len() {
        let node = flop
            .nodes
            .iter()
            .find(|n| n.history[..] == line[..k])
            .ok_or_else(|| format!("no flop decision at {:?}", &line[..k]))?;
        let a = line[k];
        let label = node.actions.get(a).ok_or_else(|| format!("no action {a} at {:?}", &line[..k]))?;
        let p = node.player;
        for (h, r) in reach[p].iter_mut().enumerate() {
            *r *= node.strategy[a][h] as f32 / 1000.0;
        }
        let mut parts = label.split(' ');
        match (parts.next(), parts.next()) {
            (Some("fold"), _) => return Err("the line ends in a fold".into()),
            (Some("check"), _) => {}
            (Some("call"), _) => street[p] = street[1 - p],
            (Some(_), Some(amount)) => street[p] = amount.parse().map_err(|_| format!("bad action {label}"))?,
            _ => return Err(format!("bad action {label}")),
        }
    }
    if flop.nodes.iter().any(|n| n.history[..] == line[..]) {
        return Err("the flop betting isn't over after this line".into());
    }
    if (street[0] - street[1]).abs() > 0.01 {
        return Err("the line ends with unequal bets".into());
    }
    Ok((reach, pot_bb + 2.0 * street[0], stack_bb - street[0]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    const SPOT: &str = "spots/preflop-v9/btn_vs_bb_srp_100.json";
    const FLOPS: &str = "output/preflop-v9/btn_vs_bb_srp_100";

    fn ranges() -> [Range; 2] {
        let spot: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(SPOT).unwrap()).unwrap();
        [spot["oop_range"].as_str().unwrap().parse().unwrap(), spot["ip_range"].as_str().unwrap().parse().unwrap()]
    }

    /// Reach rebuilt from the preflop range and the line's strategies, times the opponent's
    /// card-removal mass, must reproduce the solver's stored weights at every node on the line.
    #[test]
    fn turn_start_reach_matches_stored_weights() {
        let Some(file) = std::fs::read_dir(FLOPS).ok().and_then(|mut d| d.find_map(|e| {
            let p = e.ok()?.path();
            (p.file_name()?.to_str()?.len() == 11).then_some(p)
        })) else {
            eprintln!("skipped: no solved flops in {FLOPS}");
            return;
        };
        let flop: FlopFileIn = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let r = ranges();
        // OOP checks, IP bets the first size: check the reaches at the node where OOP faces the bet.
        let line = [0usize, 1];
        let node = flop.nodes.iter().find(|n| n.history == line).unwrap();
        // Reach so far (the line isn't over, so build it by hand rather than with turn_start).
        let mut reach: [Vec<f32>; 2] = [0, 1].map(|p| {
            flop.hands[p].iter().map(|h| { let (a, b) = parse_hand(h).unwrap(); r[p].get_weight_by_cards(a, b) }).collect()
        });
        for k in 0..line.len() {
            let n = flop.nodes.iter().find(|n| n.history[..] == line[..k]).unwrap();
            for (h, x) in reach[n.player].iter_mut().enumerate() {
                *x *= n.strategy[line[k]][h] as f32 / 1000.0;
            }
        }
        let p = node.player;
        let hands: Vec<(Card, Card)> = flop.hands[p].iter().map(|h| parse_hand(h).unwrap()).collect();
        let opp: Vec<(Card, Card)> = flop.hands[1 - p].iter().map(|h| parse_hand(h).unwrap()).collect();
        let (mut err, mut total) = (0.0f64, 0.0f64);
        for (h, &(a, b)) in hands.iter().enumerate() {
            let mass: f32 = opp.iter().zip(&reach[1 - p]).filter(|(&(c, d), _)| c != a && c != b && d != a && d != b).map(|(_, w)| w).sum();
            let ours = reach[p][h] * mass;
            err += (ours - node.weights[h]).abs() as f64;
            total += node.weights[h] as f64;
        }
        assert!(total > 0.0);
        // Strategies are stored in permille, so allow ~1% total drift.
        assert!(err / total < 0.01, "relative error {}", err / total);
    }

    #[test]
    fn turn_start_check_check_keeps_pot() {
        let Ok(text) = std::fs::read_dir(FLOPS).map(|mut d| d.find_map(|e| {
            let p = e.ok()?.path();
            (p.file_name()?.to_str()?.len() == 11).then(|| std::fs::read_to_string(p).unwrap())
        })) else { return };
        let Some(text) = text else { return };
        let flop: FlopFileIn = serde_json::from_str(&text).unwrap();
        let r = ranges();
        let (_, pot, stack) = turn_start(&flop, [&r[0], &r[1]], &[0, 0], 5.5, 97.5).unwrap();
        assert_eq!((pot, stack), (5.5, 97.5));
        let (_, pot, stack) = turn_start(&flop, [&r[0], &r[1]], &[0, 1, 1], 5.5, 97.5).unwrap();
        assert!((pot - 9.1).abs() < 1e-9 && (stack - 95.7).abs() < 1e-9, "{pot} {stack}");
        assert!(turn_start(&flop, [&r[0], &r[1]], &[0, 1], 5.5, 97.5).is_err());
        assert!(turn_start(&flop, [&r[0], &r[1]], &[0, 1, 0], 5.5, 97.5).is_err());
        assert!(Path::new(SPOT).exists());
    }
}

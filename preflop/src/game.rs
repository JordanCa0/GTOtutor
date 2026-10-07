//! The preflop game tree.
//!
//! The 6-max tree mirrors the app's hand engine (`apps/api/src/engine/handEngine.ts`): the same
//! sizes, the same action order, and the same chart lookup (`nodeKeyFor`). Every decision is
//! filed under its chart node key, so the solved strategy is exactly what the engine plays.
//!
//! One simplification keeps every flop heads-up (the flop solver only does heads-up pots): a
//! player may only call when at most one other live player has already matched the bet. A player
//! who can't call may still fold or raise. Decisions where calling is blocked get their own
//! information set (key + "|nocall"); the app's engine applies the same rule and uses them.

use std::collections::HashMap;

pub const POSITIONS: [&str; 6] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const SB: usize = 4;
const BB: usize = 5;
pub const STACK: f64 = 100.0;
const FOUR_BET: f64 = 22.0;
const ISO_RAISE: f64 = 3.5;
const SB_VS_ISO_3BET: f64 = 11.0;

fn open_size(p: usize) -> f64 {
    if p == SB {
        3.0
    } else {
        2.5
    }
}
fn three_bet_size(p: usize) -> f64 {
    if p == SB || p == BB {
        10.0
    } else {
        7.5
    }
}
/// Postflop acting order: SB, BB, then UTG..BTN (later = in position).
fn postflop_index(p: usize) -> usize {
    [2, 3, 4, 5, 0, 1][p]
}

#[derive(Clone, Debug)]
pub struct ActSpec {
    /// "fold" | "check" | "call" | "raise" | "allin", as in shared-types `ActionType`.
    pub id: &'static str,
    pub label: String,
    /// Raise-to amount; None for fold/check/call.
    pub to_bb: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct InfoSet {
    #[allow(dead_code)] // kept for debugging and future per-seat output
    pub player: usize,
    pub key: String,
    pub label: String,
    pub actions: Vec<ActSpec>,
    /// False for the "|nocall" variants (decisions where calling is blocked).
    pub export: bool,
}

#[derive(Clone, Debug)]
pub enum Node {
    Decision {
        player: usize,
        infoset: usize,
        /// Indexes into the info set's actions that are legal here.
        legal: Vec<usize>,
        children: Vec<usize>,
    },
    /// Everyone else folded.
    Fold { committed: Vec<f64>, winner: usize },
    /// Two players see a flop (or are all in). Each gets pot × equity × realization.
    Showdown {
        committed: Vec<f64>,
        a: usize,
        b: usize,
        /// Index into `Tree::realization` for each player; 0 means all-in (factor 1).
        real_a: usize,
        real_b: usize,
    },
}

/// Where a flop leaf's realization factors come from: the pot type and who is in position.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RealKey {
    pub pot_type: String,
    pub in_position: bool,
    /// Made the last preflop raise. The aggressor's range is stronger, so it realizes more.
    pub aggressor: bool,
}

pub struct Tree {
    pub num_players: usize,
    pub nodes: Vec<Node>,
    pub root: usize,
    pub infosets: Vec<InfoSet>,
    /// Realization keys in index order; index 0 is the all-in sentinel.
    pub real_keys: Vec<Option<RealKey>>,
}

#[derive(Clone)]
struct State {
    committed: [f64; 6],
    folded: [bool; 6],
    acted: [bool; 6],
    current_bet: f64,
    raise_level: u32,
    opener: Option<usize>,
    limper: Option<usize>,
    last_raiser: Option<usize>,
    prev_raiser: Option<usize>,
    last_actor: usize,
}

impl State {
    fn new() -> State {
        let mut committed = [0.0; 6];
        committed[SB] = 0.5;
        committed[BB] = 1.0;
        State {
            committed,
            folded: [false; 6],
            acted: [false; 6],
            current_bet: 1.0,
            raise_level: 0,
            opener: None,
            limper: None,
            last_raiser: None,
            prev_raiser: None,
            last_actor: BB,
        }
    }
    fn all_in(&self, p: usize) -> bool {
        self.committed[p] >= STACK
    }
    fn live(&self) -> Vec<usize> {
        (0..6).filter(|&p| !self.folded[p]).collect()
    }
    fn next_to_act(&self) -> Option<usize> {
        (1..=6).map(|s| (self.last_actor + s) % 6).find(|&p| {
            !self.folded[p] && !self.all_in(p) && (!self.acted[p] || self.committed[p] < self.current_bet)
        })
    }
}

struct Builder {
    nodes: Vec<Node>,
    infosets: Vec<InfoSet>,
    index: HashMap<String, usize>,
    real_keys: Vec<Option<RealKey>>,
}

impl Builder {
    fn infoset(&mut self, player: usize, key: String, label: String, actions: Vec<ActSpec>, export: bool) -> usize {
        if let Some(&i) = self.index.get(&key) {
            return i;
        }
        self.infosets.push(InfoSet { player, key: key.clone(), label, actions, export });
        self.index.insert(key, self.infosets.len() - 1);
        self.infosets.len() - 1
    }

    fn real(&mut self, key: RealKey) -> usize {
        if let Some(i) = self.real_keys.iter().position(|k| k.as_ref() == Some(&key)) {
            return i;
        }
        self.real_keys.push(Some(key));
        self.real_keys.len() - 1
    }

    fn push(&mut self, n: Node) -> usize {
        self.nodes.push(n);
        self.nodes.len() - 1
    }

    fn build(&mut self, s: &State) -> usize {
        let live = s.live();
        if live.len() == 1 {
            return self.push(Node::Fold { committed: s.committed.to_vec(), winner: live[0] });
        }
        let Some(p) = s.next_to_act() else {
            assert_eq!(live.len(), 2, "the call rule keeps every flop heads-up");
            return self.flop(s, live[0], live[1]);
        };
        let (key, label, actions) = chart_node(s, p);
        let matched_others = (0..6).filter(|&q| q != p && !s.folded[q] && s.committed[q] >= s.current_bet).count();
        let call_ok = matched_others <= 1;
        let legal: Vec<usize> = (0..actions.len()).filter(|&i| call_ok || actions[i].id != "call").collect();
        let infoset = if call_ok {
            self.infoset(p, key, label, actions.clone(), true)
        } else {
            let kept: Vec<ActSpec> = legal.iter().map(|&i| actions[i].clone()).collect();
            self.infoset(p, format!("{key}|nocall"), format!("{label} (no overcall)"), kept, false)
        };
        let n_actions = self.infosets[infoset].actions.len();
        let mut children = Vec::with_capacity(legal.len());
        for &i in &legal {
            let mut next = s.clone();
            apply(&mut next, p, &actions[i]);
            children.push(self.build(&next));
        }
        // Nocall info sets store only legal actions, so their legal list is the identity.
        let legal = if call_ok { legal } else { (0..n_actions).collect() };
        self.push(Node::Decision { player: p, infoset, legal, children })
    }

    fn flop(&mut self, s: &State, a: usize, b: usize) -> usize {
        let committed = s.committed.to_vec();
        if s.all_in(a) || s.all_in(b) {
            return self.push(Node::Showdown { committed, a, b, real_a: 0, real_b: 0 });
        }
        let pot_type = match (s.limper.is_some(), s.raise_level) {
            (true, 0) => "limp",
            (true, 1) => "iso",
            (true, _) => "l3b",
            (false, 1) => "srp",
            (false, 2) => "3bp",
            _ => "4bp",
        }
        .to_string();
        let a_ip = postflop_index(a) > postflop_index(b);
        let real_a = self.real(RealKey { pot_type: pot_type.clone(), in_position: a_ip, aggressor: s.last_raiser == Some(a) });
        let real_b = self.real(RealKey { pot_type, in_position: !a_ip, aggressor: s.last_raiser == Some(b) });
        self.push(Node::Showdown { committed, a, b, real_a, real_b })
    }
}

fn act(id: &'static str, label: impl Into<String>, to_bb: Option<f64>) -> ActSpec {
    ActSpec { id, label: label.into(), to_bb }
}

fn key(kind: &str, p: usize, vs: Option<usize>) -> String {
    match vs {
        Some(v) => format!("SIX_MAX|100|{kind}|{}|{}", POSITIONS[p], POSITIONS[v]),
        None => format!("SIX_MAX|100|{kind}|{}", POSITIONS[p]),
    }
}

/// Chart node key, label and actions for player `p`: a port of the engine's `nodeKeyFor`, with
/// labels and actions as in `apps/api/src/charts/fixtures.ts`.
fn chart_node(s: &State, p: usize) -> (String, String, Vec<ActSpec>) {
    let pos = POSITIONS[p];
    let fold = || act("fold", "Fold", None);
    let call = || act("call", "Call", None);
    let four_bet = || act("raise", format!("4-bet to {FOUR_BET}"), Some(FOUR_BET));
    let jam = || act("allin", format!("All-in {STACK}"), Some(STACK));
    let call_jam = || act("call", "Call all-in", None);
    if s.raise_level == 0 {
        if p == BB {
            let l = s.limper.unwrap();
            return (key("VS_LIMP", p, Some(l)), "BB facing SB limp".into(), vec![act("check", "Check", None), act("raise", format!("Raise to {ISO_RAISE}"), Some(ISO_RAISE))]);
        }
        let raise = act("raise", format!("Raise to {}", open_size(p)), Some(open_size(p)));
        if p == SB {
            return (key("RFI", p, None), "SB first in (raise, limp, or fold)".into(), vec![fold(), act("call", "Limp", None), raise]);
        }
        return (key("RFI", p, None), format!("{pos} first in (open-raise or fold)"), vec![fold(), raise]);
    }
    if s.raise_level == 1 {
        let o = s.opener.unwrap();
        if Some(p) == s.limper {
            return (key("VS_ISO", p, Some(o)), "SB (limped) facing BB raise".into(), vec![fold(), call(), act("raise", format!("3-bet to {SB_VS_ISO_3BET}"), Some(SB_VS_ISO_3BET))]);
        }
        let size = three_bet_size(p);
        return (key("VS_OPEN", p, Some(o)), format!("{pos} facing {} open", POSITIONS[o]), vec![fold(), call(), act("raise", format!("3-bet to {size}"), Some(size))]);
    }
    let (direct, cold, what, actions): (&str, &str, &str, Vec<ActSpec>) = match s.raise_level {
        2 => ("VS_3BET", "COLD_VS_3BET", "3-bet", vec![fold(), call(), four_bet()]),
        3 => ("VS_4BET", "COLD_VS_4BET", "4-bet", vec![fold(), call(), jam()]),
        _ => ("VS_5BET", "COLD_VS_5BET", "5-bet all-in", vec![fold(), call_jam()]),
    };
    if Some(p) == s.prev_raiser {
        let r = s.last_raiser.unwrap();
        let role = match s.raise_level {
            2 => "(opener) facing",
            3 => "(3-bettor) facing",
            _ => "(4-bettor) facing",
        };
        let tail = match s.raise_level {
            2 => "3-bet",
            3 => "4-bet",
            _ => "all-in",
        };
        return (key(direct, p, Some(r)), format!("{pos} {role} {} {tail}", POSITIONS[r]), actions);
    }
    (key(cold, p, None), format!("{pos} cold, facing a {what}"), actions)
}

/// Same state changes as the engine's `apply`.
fn apply(s: &mut State, p: usize, a: &ActSpec) {
    match a.id {
        "fold" => s.folded[p] = true,
        "check" => {}
        "call" => {
            if s.raise_level == 0 {
                s.limper = Some(p);
            }
            s.committed[p] = s.current_bet.min(STACK);
        }
        _ => {
            let to = a.to_bb.unwrap().min(STACK);
            s.committed[p] = to;
            s.current_bet = to;
            if s.raise_level == 0 {
                s.opener = Some(p);
            }
            s.prev_raiser = s.last_raiser;
            s.last_raiser = Some(p);
            s.raise_level += 1;
        }
    }
    s.acted[p] = true;
    s.last_actor = p;
}

pub fn build_six_max() -> Tree {
    let mut b = Builder { nodes: Vec::new(), infosets: Vec::new(), index: HashMap::new(), real_keys: vec![None] };
    let root = b.build(&State::new());
    Tree { num_players: 6, nodes: b.nodes, root, infosets: b.infosets, real_keys: b.real_keys }
}

#[cfg(test)]
/// Heads-up push/fold at `stack` bb, for testing the solver against known results.
pub fn build_push_fold(stack: f64) -> Tree {
    let mut nodes = Vec::new();
    let mut infosets = Vec::new();
    infosets.push(InfoSet { player: 0, key: "SB".into(), label: "SB".into(), actions: vec![act("fold", "Fold", None), act("allin", "Push", Some(stack))], export: true });
    infosets.push(InfoSet { player: 1, key: "BB".into(), label: "BB".into(), actions: vec![act("fold", "Fold", None), act("call", "Call", None)], export: true });
    nodes.push(Node::Fold { committed: vec![0.5, 1.0], winner: 1 }); // 0: SB folds
    nodes.push(Node::Fold { committed: vec![stack, 1.0], winner: 0 }); // 1: BB folds
    nodes.push(Node::Showdown { committed: vec![stack, stack], a: 0, b: 1, real_a: 0, real_b: 0 }); // 2
    nodes.push(Node::Decision { player: 1, infoset: 1, legal: vec![0, 1], children: vec![1, 2] }); // 3
    nodes.push(Node::Decision { player: 0, infoset: 0, legal: vec![0, 1], children: vec![0, 3] }); // 4
    Tree { num_players: 2, nodes, root: 4, infosets, real_keys: vec![None] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn six_max_tree_matches_the_engine() {
        let t = build_six_max();
        let keys: Vec<&str> = t.infosets.iter().filter(|i| i.export).map(|i| i.key.as_str()).collect();
        for k in [
            "SIX_MAX|100|RFI|UTG",
            "SIX_MAX|100|RFI|SB",
            "SIX_MAX|100|VS_OPEN|BB|BTN",
            "SIX_MAX|100|VS_OPEN|SB|CO",
            "SIX_MAX|100|VS_3BET|BTN|BB",
            "SIX_MAX|100|VS_4BET|BB|BTN",
            "SIX_MAX|100|VS_5BET|BTN|BB",
            "SIX_MAX|100|COLD_VS_3BET|BB",
            "SIX_MAX|100|VS_LIMP|BB|SB",
            "SIX_MAX|100|VS_ISO|SB|BB",
        ] {
            assert!(keys.contains(&k), "missing {k}");
        }
        // Nothing impossible: UTG never faces an open.
        assert!(!keys.iter().any(|k| k.contains("VS_OPEN|UTG")));
        // Every flop is heads-up, and every pot adds up.
        for n in &t.nodes {
            if let Node::Showdown { committed, a, b, .. } = n {
                assert_ne!(a, b);
                assert!(committed[*a] == committed[*b], "flop players have matched bets");
            }
        }
        let vs_open = t.infosets.iter().find(|i| i.key == "SIX_MAX|100|VS_OPEN|BTN|CO").unwrap();
        assert_eq!(vs_open.label, "BTN facing CO open");
        assert_eq!(vs_open.actions[2].label, "3-bet to 7.5");
        println!("{} nodes, {} info sets", t.nodes.len(), t.infosets.len());
    }
}

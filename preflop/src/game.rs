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
//!
//! Stacks come from a profile (`docs/stack-depths-plan.md`): "100", "60" and "20" for equal stacks,
//! or a base depth plus exceptions such as "100:BB20". Each player's actions and sizes follow their
//! own stack's tier (see `Tier`); the 100bb tree is exactly the v9 tree.

use std::collections::HashMap;

pub const POSITIONS: [&str; 6] = ["UTG", "HJ", "CO", "BTN", "SB", "BB"];
const SB: usize = 4;
const BB: usize = 5;
const FOUR_BET: f64 = 22.0;
/// The 4-bet at 60bb: 20 leaves about 40bb behind, so the 5-bet is all-in.
const FOUR_BET_MID: f64 = 20.0;
/// The open at 20bb (every position, the SB included).
const SHORT_OPEN: f64 = 2.0;
/// BB isolating an SB limp (unchanged since v8).
const ISO_RAISE: f64 = 3.5;
/// Isolating any other limp: anyone behind a UTG–BTN limper, or the SB/BB isolating them.
const ISO_RAISE_VS_LIMP: f64 = 4.5;
/// The limper re-raising an isolation raise.
const SB_VS_ISO_3BET: f64 = 11.0;

fn open_size(p: usize) -> f64 {
    if p == SB {
        3.0
    } else {
        2.5
    }
}
fn iso_size(p: usize, limper: usize) -> f64 {
    if p == BB && limper == SB {
        ISO_RAISE
    } else {
        ISO_RAISE_VS_LIMP
    }
}
fn three_bet_size(p: usize) -> f64 {
    if p == SB || p == BB {
        10.0
    } else {
        7.5
    }
}

/// Which tree a player's own stack plays: 100bb (v9), 60bb (a smaller 4-bet), or 20bb (shove or
/// fold: open 2.0 or shove first in, the SB may limp, and every re-raise is all-in).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tier {
    Short,
    Mid,
    Deep,
}

impl Tier {
    pub fn of(stack: f64) -> Tier {
        if stack <= 30.0 {
            Tier::Short
        } else if stack <= 80.0 {
            Tier::Mid
        } else {
            Tier::Deep
        }
    }
    /// The depth a tier's realization curves are measured at (the `--realization <depth>=<file>` key).
    pub fn depth(self) -> u32 {
        match self {
            Tier::Short => 20,
            Tier::Mid => 60,
            Tier::Deep => 100,
        }
    }
}

/// Each position's stack, UTG to BB, and the profile id used in chart node keys.
#[derive(Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub stacks: [f64; 6],
}

impl Profile {
    /// "100", "60", "20", or a base depth plus exceptions: "100:BB20", "60:UTG20:SB20".
    pub fn parse(id: &str) -> Result<Profile, String> {
        let mut parts = id.split(':');
        let base: f64 = parts.next().and_then(|b| b.parse().ok()).filter(|&b: &f64| b >= 2.0).ok_or(format!("bad stack profile {id}"))?;
        let mut stacks = [base; 6];
        for part in parts {
            let p = POSITIONS
                .iter()
                .position(|pos| part.strip_prefix(pos).is_some_and(|n| n.parse::<f64>().is_ok_and(|v| v >= 2.0)))
                .ok_or(format!("bad stack exception {part} in {id} (write it like BB20)"))?;
            stacks[p] = part[POSITIONS[p].len()..].parse().unwrap();
        }
        Ok(Profile { id: id.to_string(), stacks })
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

/// Where a flop leaf's realization factors come from: the pot type, who is in position, and the depth.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RealKey {
    pub pot_type: String,
    pub in_position: bool,
    /// Made the last preflop raise. The aggressor's range is stronger, so it realizes more.
    pub aggressor: bool,
    /// The effective stack's tier depth (20, 60 or 100): each depth has its own realization file.
    pub depth: u32,
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
    stacks: [f64; 6],
}

impl State {
    fn new(stacks: [f64; 6]) -> State {
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
            stacks,
        }
    }
    fn all_in(&self, p: usize) -> bool {
        self.committed[p] >= self.stacks[p]
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
    profile: String,
    nodes: Vec<Node>,
    infosets: Vec<InfoSet>,
    index: HashMap<String, usize>,
    real_keys: Vec<Option<RealKey>>,
}

impl Builder {
    fn infoset(&mut self, player: usize, key: String, label: String, actions: Vec<ActSpec>, export: bool) -> usize {
        if let Some(&i) = self.index.get(&key) {
            // One chart node, one action list: two lines reaching a key with different actions
            // would merge decisions the app tells apart.
            let same = |a: &[ActSpec], b: &[ActSpec]| a.len() == b.len() && a.iter().zip(b).all(|(x, y)| x.id == y.id && x.to_bb == y.to_bb);
            assert!(same(&self.infosets[i].actions, &actions), "chart node {key} reached with different actions");
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
        // Behind an isolation raise, everyone but the limper folds: the pot stays limper vs isolator.
        // (A third player calling or 3-betting here would land on the same chart nodes as ordinary
        // open/3-bet lines with different sizes; limps are rare enough that this costs little.)
        if s.raise_level == 1 && s.limper.is_some_and(|l| l != p) {
            let mut next = s.clone();
            apply(&mut next, p, &act("fold", "Fold", None));
            return self.build(&next);
        }
        let (key, label, actions) = chart_node(&self.profile, s, p);
        let matched_others = (0..6).filter(|&q| q != p && !s.folded[q] && s.committed[q] >= s.current_bet.min(s.stacks[q])).count();
        // Nodes without a call (facing a limp: fold or isolate) need no "|nocall" variant.
        let call_ok = matched_others <= 1 || !actions.iter().any(|a| a.id == "call");
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
        let mut committed = s.committed.to_vec();
        if s.all_in(a) || s.all_in(b) {
            // A shorter stack is all in: the bigger stack's chips beyond it come back.
            let matched = committed[a].min(committed[b]);
            committed[a] = matched;
            committed[b] = matched;
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
        // Realization follows the effective stack: the shorter of the two.
        let depth = Tier::of(s.stacks[a].min(s.stacks[b])).depth();
        let real_a = self.real(RealKey { pot_type: pot_type.clone(), in_position: a_ip, aggressor: s.last_raiser == Some(a), depth });
        let real_b = self.real(RealKey { pot_type, in_position: !a_ip, aggressor: s.last_raiser == Some(b), depth });
        self.push(Node::Showdown { committed, a, b, real_a, real_b })
    }
}

fn act(id: &'static str, label: impl Into<String>, to_bb: Option<f64>) -> ActSpec {
    ActSpec { id, label: label.into(), to_bb }
}

fn key(profile: &str, kind: &str, p: usize, vs: Option<usize>) -> String {
    match vs {
        Some(v) => format!("SIX_MAX|{profile}|{kind}|{}|{}", POSITIONS[p], POSITIONS[v]),
        None => format!("SIX_MAX|{profile}|{kind}|{}", POSITIONS[p]),
    }
}

/// Fits a player's actions to their stack: a raise to their stack or more becomes their all-in,
/// and once the bet covers their stack only fold and call remain.
fn fit_to_stack(actions: Vec<ActSpec>, stack: f64, current_bet: f64) -> Vec<ActSpec> {
    let mut out: Vec<ActSpec> = Vec::new();
    for a in actions {
        if a.to_bb.is_some() && current_bet >= stack {
            continue;
        }
        let a = match a.to_bb {
            Some(to) if to >= stack && a.id != "allin" => act("allin", format!("All-in {stack}"), Some(stack)),
            _ => a,
        };
        if !out.iter().any(|o| o.id == a.id && o.to_bb == a.to_bb) {
            out.push(a);
        }
    }
    out
}

/// Chart node key, label and actions for player `p`: a port of the engine's `nodeKeyFor`, with
/// labels and actions as in `apps/api/src/charts/fixtures.ts`.
fn chart_node(profile: &str, s: &State, p: usize) -> (String, String, Vec<ActSpec>) {
    let (k, label, actions) = tier_node(profile, s, p);
    (k, label, fit_to_stack(actions, s.stacks[p], s.current_bet))
}

fn tier_node(profile: &str, s: &State, p: usize) -> (String, String, Vec<ActSpec>) {
    let pos = POSITIONS[p];
    let stack = s.stacks[p];
    let tier = Tier::of(stack);
    let key = |kind: &str, p: usize, vs: Option<usize>| key(profile, kind, p, vs);
    let fold = || act("fold", "Fold", None);
    let call = || act("call", "Call", None);
    let four_bet_size = if tier == Tier::Mid { FOUR_BET_MID } else { FOUR_BET };
    let four_bet = || act("raise", format!("4-bet to {four_bet_size}"), Some(four_bet_size));
    let jam = || act("allin", format!("All-in {stack}"), Some(stack));
    let call_jam = || act("call", "Call all-in", None);
    // Facing an all-in below the 5-bet (it only happens with a 20bb stack at the table): fold or
    // call, under its own key, as the same spot facing a normal raise offers a re-raise.
    if s.raise_level < 4 && s.last_raiser.is_some_and(|r| s.all_in(r)) {
        let r = s.last_raiser.unwrap();
        return (key("VS_ALLIN", p, Some(r)), format!("{pos} facing {} all-in", POSITIONS[r]), vec![fold(), call_jam()]);
    }
    if tier == Tier::Short {
        // 20bb: open 2.0 or shove first in (the SB may also limp); facing anything, call or shove.
        if s.raise_level == 0 {
            if let Some(l) = s.limper {
                let passive = if p == BB { act("check", "Check", None) } else { fold() };
                return (key("VS_LIMP", p, Some(l)), format!("{pos} facing {} limp", POSITIONS[l]), vec![passive, jam()]);
            }
            let open = act("raise", format!("Raise to {SHORT_OPEN}"), Some(SHORT_OPEN));
            let actions = if p == SB { vec![fold(), act("call", "Limp", None), open, jam()] } else { vec![fold(), open, jam()] };
            return (key("RFI", p, None), format!("{pos} first in (raise, shove, or fold)"), actions);
        }
        let (k, label) = facing_raise_key(profile, s, p);
        return (k, label, vec![fold(), call(), jam()]);
    }
    if s.raise_level == 0 {
        if let Some(l) = s.limper {
            // Facing a limp: isolate, or check (BB) / fold (anyone else). Over-limping isn't allowed:
            // the limper and the BB have both matched the bet, so the heads-up rule blocks a call.
            let iso = iso_size(p, l);
            let raise = act("raise", format!("Raise to {iso}"), Some(iso));
            let passive = if p == BB { act("check", "Check", None) } else { fold() };
            return (key("VS_LIMP", p, Some(l)), format!("{pos} facing {} limp", POSITIONS[l]), vec![passive, raise]);
        }
        let raise = act("raise", format!("Raise to {}", open_size(p)), Some(open_size(p)));
        if p == SB {
            return (key("RFI", p, None), "SB first in (raise, limp, or fold)".into(), vec![fold(), act("call", "Limp", None), raise]);
        }
        return (key("RFI", p, None), format!("{pos} first in (raise, limp, or fold)"), vec![fold(), act("call", "Limp", None), raise]);
    }
    let actions = match s.raise_level {
        1 if Some(p) == s.limper => vec![fold(), call(), act("raise", format!("3-bet to {SB_VS_ISO_3BET}"), Some(SB_VS_ISO_3BET))],
        1 => {
            let size = three_bet_size(p);
            vec![fold(), call(), act("raise", format!("3-bet to {size}"), Some(size))]
        }
        2 => vec![fold(), call(), four_bet()],
        3 => vec![fold(), call(), jam()],
        _ => vec![fold(), call_jam()],
    };
    let (k, label) = facing_raise_key(profile, s, p);
    (k, label, actions)
}

/// Key and label for a decision facing a raise (open, isolation, 3-bet and up), the same in every tier.
fn facing_raise_key(profile: &str, s: &State, p: usize) -> (String, String) {
    let pos = POSITIONS[p];
    if s.raise_level == 1 {
        let o = s.opener.unwrap();
        if Some(p) == s.limper {
            return (key(profile, "VS_ISO", p, Some(o)), format!("{pos} (limped) facing {} raise", POSITIONS[o]));
        }
        return (key(profile, "VS_OPEN", p, Some(o)), format!("{pos} facing {} open", POSITIONS[o]));
    }
    let (direct, cold, what) = match s.raise_level {
        2 => ("VS_3BET", "COLD_VS_3BET", "3-bet"),
        3 => ("VS_4BET", "COLD_VS_4BET", "4-bet"),
        _ => ("VS_5BET", "COLD_VS_5BET", "5-bet all-in"),
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
        return (key(profile, direct, p, Some(r)), format!("{pos} {role} {} {tail}", POSITIONS[r]));
    }
    (key(profile, cold, p, None), format!("{pos} cold, facing a {what}"))
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
            s.committed[p] = s.current_bet.min(s.stacks[p]);
        }
        _ => {
            let to = a.to_bb.unwrap().min(s.stacks[p]);
            s.committed[p] = to;
            s.current_bet = s.current_bet.max(to);
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

pub fn build_six_max(profile: &Profile) -> Tree {
    let mut b = Builder { profile: profile.id.clone(), nodes: Vec::new(), infosets: Vec::new(), index: HashMap::new(), real_keys: vec![None] };
    let root = b.build(&State::new(profile.stacks));
    Tree { num_players: 6, nodes: b.nodes, root, infosets: b.infosets, real_keys: b.real_keys }
}

/// The stack profiles solved exactly (`docs/stack-depths-plan.md`): equal stacks at 100, 60 and 20,
/// and one short stack at each position.
pub fn planned_profiles() -> Vec<String> {
    let mut out: Vec<String> = ["100", "60", "20"].iter().map(|s| s.to_string()).collect();
    for (base, short) in [(100, 20), (100, 60), (60, 20)] {
        for pos in POSITIONS {
            out.push(format!("{base}:{pos}{short}"));
        }
    }
    out
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

    fn tree(id: &str) -> Tree {
        build_six_max(&Profile::parse(id).unwrap())
    }

    #[test]
    fn six_max_tree_matches_the_engine() {
        let t = tree("100");
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
        // Nothing impossible: UTG never faces an open, and nobody faces an all-in below the 5-bet.
        assert!(!keys.iter().any(|k| k.contains("VS_OPEN|UTG")));
        assert!(!keys.iter().any(|k| k.contains("VS_ALLIN")));
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

        // Limping from every position (v9): first in is fold, limp or raise.
        let ids = |key: &str| t.infosets.iter().find(|i| i.key == key).unwrap_or_else(|| panic!("missing {key}")).actions.iter().map(|a| a.id).collect::<Vec<_>>();
        for pos in ["UTG", "HJ", "CO", "BTN", "SB"] {
            assert_eq!(ids(&format!("SIX_MAX|100|RFI|{pos}")), ["fold", "call", "raise"], "{pos} first in");
        }
        // Facing a limp: fold or isolate (check or isolate for the BB); never an over-limp.
        assert_eq!(ids("SIX_MAX|100|VS_LIMP|HJ|UTG"), ["fold", "raise"]);
        assert_eq!(ids("SIX_MAX|100|VS_LIMP|SB|BTN"), ["fold", "raise"]);
        assert_eq!(ids("SIX_MAX|100|VS_LIMP|BB|CO"), ["check", "raise"]);
        let iso = t.infosets.iter().find(|i| i.key == "SIX_MAX|100|VS_LIMP|BTN|UTG").unwrap();
        assert_eq!((iso.label.as_str(), iso.actions[1].to_bb), ("BTN facing UTG limp", Some(4.5)));
        assert_eq!(t.infosets.iter().find(|i| i.key == "SIX_MAX|100|VS_LIMP|BB|SB").unwrap().actions[1].to_bb, Some(3.5), "BB vs SB limp unchanged");
        assert!(!keys.iter().any(|k| k.starts_with("SIX_MAX|100|VS_LIMP") && k.ends_with("|nocall")));
        // The limper facing an isolation raise, and the isolator facing the limp-re-raise.
        assert_eq!(ids("SIX_MAX|100|VS_ISO|UTG|CO"), ["fold", "call", "raise"]);
        assert_eq!(ids("SIX_MAX|100|VS_3BET|CO|UTG"), ["fold", "call", "raise"]);
        println!("{} nodes, {} info sets", t.nodes.len(), t.infosets.len());
    }

    #[test]
    fn profiles_parse() {
        assert_eq!(Profile::parse("100").unwrap().stacks, [100.0; 6]);
        assert_eq!(Profile::parse("100:BB20").unwrap().stacks, [100.0, 100.0, 100.0, 100.0, 100.0, 20.0]);
        assert_eq!(Profile::parse("60:UTG20:SB20").unwrap().stacks, [20.0, 60.0, 60.0, 60.0, 20.0, 60.0]);
        assert!(Profile::parse("100:XX20").is_err());
        assert!(Profile::parse("abc").is_err());
    }

    #[test]
    fn sixty_bb_is_100bb_with_a_smaller_4_bet() {
        let t = tree("60");
        let node = |key: &str| t.infosets.iter().find(|i| i.key == key).unwrap_or_else(|| panic!("missing {key}"));
        assert_eq!(node("SIX_MAX|60|VS_3BET|BTN|BB").actions[2].to_bb, Some(20.0));
        assert_eq!(node("SIX_MAX|60|VS_4BET|BB|BTN").actions[2].to_bb, Some(60.0));
        assert_eq!(node("SIX_MAX|60|RFI|UTG").actions.iter().map(|a| a.id).collect::<Vec<_>>(), ["fold", "call", "raise"]);
    }

    #[test]
    fn twenty_bb_is_shove_or_fold() {
        let t = tree("20");
        let ids = |key: &str| t.infosets.iter().find(|i| i.key == key).unwrap_or_else(|| panic!("missing {key}")).actions.iter().map(|a| a.id).collect::<Vec<_>>();
        assert_eq!(ids("SIX_MAX|20|RFI|UTG"), ["fold", "raise", "allin"]);
        assert_eq!(ids("SIX_MAX|20|RFI|SB"), ["fold", "call", "raise", "allin"]);
        assert_eq!(ids("SIX_MAX|20|VS_OPEN|BB|BTN"), ["fold", "call", "allin"]);
        assert_eq!(ids("SIX_MAX|20|VS_LIMP|BB|SB"), ["check", "allin"]);
        assert_eq!(ids("SIX_MAX|20|VS_ALLIN|BB|BTN"), ["fold", "call"]);
        // Only a called 2.0 open and a checked SB limp see a flop with chips behind.
        for n in &t.nodes {
            if let Node::Showdown { real_a, .. } = n {
                if *real_a != 0 {
                    let k = t.real_keys[*real_a].as_ref().unwrap();
                    assert!(["srp", "limp"].contains(&k.pot_type.as_str()), "unexpected 20bb flop pot {}", k.pot_type);
                    assert_eq!(k.depth, 20);
                }
            }
        }
    }

    #[test]
    fn every_planned_profile_builds_with_stacks_respected() {
        for id in planned_profiles() {
            let profile = Profile::parse(&id).unwrap();
            let t = build_six_max(&profile);
            assert!(t.infosets.iter().all(|i| i.key.starts_with(&format!("SIX_MAX|{id}|"))), "{id}: keys carry the profile");
            for info in &t.infosets {
                let pos = POSITIONS.iter().position(|p| info.key.split('|').nth(3) == Some(*p)).unwrap();
                for a in &info.actions {
                    if let Some(to) = a.to_bb {
                        assert!(to <= profile.stacks[pos], "{id}: {} bets {to} with a {} stack", info.key, profile.stacks[pos]);
                    }
                }
            }
            for n in &t.nodes {
                if let Node::Showdown { committed, a, b, .. } = n {
                    assert!(committed[*a] == committed[*b], "{id}: flop players have matched bets");
                    assert!(committed[*a] <= profile.stacks[*a].min(profile.stacks[*b]), "{id}: nobody wins more than the short stack");
                }
            }
            println!("{id}: {} nodes, {} info sets", t.nodes.len(), t.infosets.len());
        }
    }
}

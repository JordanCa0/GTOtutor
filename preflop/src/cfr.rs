//! Discounted CFR over hand-class ranges.
//!
//! Each player holds one of 169 classes, dealt independently with probability combos/1326 (card
//! removal between players is ignored). A traversal carries every player's reach vector and
//! returns every player's counterfactual values, so one pass updates all players at once.

use crate::cards::NUM_CLASSES as H;
use crate::equity::EquityTable;
use crate::game::{Node, Tree};
use crate::realization::{rank_in_range, Model};

pub struct Solver<'a> {
    pub tree: &'a Tree,
    eq: &'a EquityTable,
    probs: Vec<f64>,
    model: Model,
    /// Per flop leaf (indexed like `tree.nodes`), realization per class for players a and b.
    /// Recomputed from the average strategy by `refresh_realization`; None = all-in (factor 1).
    leaf_real: Vec<Option<[Vec<f64>; 2]>>,
    ones: Vec<f64>,
    regrets: Vec<Vec<f64>>,
    strat_sum: Vec<Vec<f64>>,
    current: Vec<Vec<f64>>,
    d_regret: Vec<Vec<f64>>,
    d_strat: Vec<Vec<f64>>,
    /// One-hot strategies used by Mode::Policy.
    policy: Vec<Vec<f64>>,
    /// Per info set: an action played at least this often while training (see `set_action_floor`).
    floor: Vec<Option<(usize, f64)>>,
    pub iterations: u32,
}

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    /// Training: current strategies, accumulate regrets.
    Train,
    /// Everyone plays the average strategy.
    Average,
    /// Everyone plays the average strategy except this player, who best-responds.
    BestResponse(usize),
    /// Everyone plays the average strategy except this player, who plays `policy`.
    Policy(usize),
}

/// Per info set, per action, per class: expected net result (bb from the start of the hand).
pub struct ActionEvs {
    pub ev: Vec<Vec<f64>>,
    /// Per info set, per class: probability of reaching it while holding that class.
    pub reach: Vec<Vec<f64>>,
}

impl<'a> Solver<'a> {
    pub fn new(tree: &'a Tree, eq: &'a EquityTable, probs: Vec<f64>, model: Model) -> Solver<'a> {
        let size = |i: usize| tree.infosets[i].actions.len() * H;
        let zeros = || (0..tree.infosets.len()).map(|i| vec![0.0; size(i)]).collect::<Vec<_>>();
        let mut s = Solver {
            tree,
            eq,
            probs,
            model,
            leaf_real: vec![None; tree.nodes.len()],
            ones: vec![1.0; H],
            regrets: zeros(),
            strat_sum: zeros(),
            current: zeros(),
            d_regret: zeros(),
            d_strat: zeros(),
            policy: zeros(),
            floor: vec![None; tree.infosets.len()],
            iterations: 0,
        };
        s.refresh_realization();
        s
    }

    /// Recomputes every flop leaf's realization from the ranges the average strategy brings there:
    /// each class is ranked inside its own range by equity against the opponent's range, and the
    /// realization model turns that rank into a factor. The game's payoffs move with the ranges, so
    /// this runs every so often while solving and is held fixed for the final iterations.
    pub fn refresh_realization(&mut self) {
        let mut leaves = Vec::new();
        self.collect_leaf_reach(self.tree.root, &vec![1.0; self.tree.num_players * H], &mut leaves);
        for (node, reach) in leaves {
            let Node::Showdown { a, b, real_a, real_b, .. } = &self.tree.nodes[node] else { continue };
            if *real_a == 0 {
                continue; // all in: realization is exactly the equity
            }
            let side = |me: usize, opp: usize, key: usize| {
                let w_opp: Vec<f64> = (0..H).map(|y| self.probs[y] * reach[opp * H + y]).collect();
                let w_opp = if w_opp.iter().sum::<f64>() > 0.0 { w_opp } else { self.probs.clone() };
                let total: f64 = w_opp.iter().sum();
                let equity: Vec<f64> = (0..H).map(|x| self.eq.eq[x * H..(x + 1) * H].iter().zip(&w_opp).map(|(e, w)| e * w).sum::<f64>() / total).collect();
                let own: Vec<f64> = (0..H).map(|x| self.probs[x] * reach[me * H + x]).collect();
                self.model.factors(key, &rank_in_range(&equity, &own))
            };
            let fa = side(*a, *b, *real_a);
            let fb = side(*b, *a, *real_b);
            self.leaf_real[node] = Some([fa, fb]);
        }
    }

    /// Reach of every player at every flop leaf under the average strategy.
    fn collect_leaf_reach(&self, node: usize, reach: &[f64], out: &mut Vec<(usize, Vec<f64>)>) {
        match &self.tree.nodes[node] {
            Node::Fold { .. } => {}
            Node::Showdown { .. } => out.push((node, reach.to_vec())),
            Node::Decision { player, infoset, legal, children } => {
                let strat = self.average_strategy(*infoset);
                for (k, &child) in children.iter().enumerate() {
                    let mut next = reach.to_vec();
                    for h in 0..H {
                        next[player * H + h] *= strat[legal[k] * H + h];
                    }
                    self.collect_leaf_reach(child, &next, out);
                }
            }
        }
    }

    /// While training, play `action` at `infoset` at least `floor` of the time with every hand.
    ///
    /// A line the equilibrium almost never takes (open-limping from UTG–BTN) otherwise gets almost
    /// no traffic, so the strategies after it (isolating, the limper's reply) stay close to arbitrary.
    /// The floor gives them real traffic. The average strategy (the charts) still accumulates the
    /// unadjusted strategy, so the charts don't show the forced share.
    pub fn set_action_floor(&mut self, infoset: usize, action: usize, floor: f64) {
        self.floor[infoset] = Some((action, floor));
    }

    /// Regret matching: play actions in proportion to positive regret (uniform if none).
    fn update_current(&mut self) {
        for (i, cur) in self.current.iter_mut().enumerate() {
            let n = self.tree.infosets[i].actions.len();
            let r = &self.regrets[i];
            for h in 0..H {
                let total: f64 = (0..n).map(|a| r[a * H + h].max(0.0)).sum();
                for a in 0..n {
                    cur[a * H + h] = if total > 0.0 { r[a * H + h].max(0.0) / total } else { 1.0 / n as f64 };
                }
            }
        }
    }

    pub fn average_strategy(&self, infoset: usize) -> Vec<f64> {
        let n = self.tree.infosets[infoset].actions.len();
        let s = &self.strat_sum[infoset];
        let mut out = vec![0.0; n * H];
        for h in 0..H {
            let total: f64 = (0..n).map(|a| s[a * H + h]).sum();
            for a in 0..n {
                out[a * H + h] = if total > 0.0 { s[a * H + h] / total } else { self.current[infoset][a * H + h] };
            }
        }
        out
    }

    pub fn iterate(&mut self) {
        self.update_current();
        for d in self.d_regret.iter_mut().chain(self.d_strat.iter_mut()) {
            d.iter_mut().for_each(|x| *x = 0.0);
        }
        let reach = vec![1.0; self.tree.num_players * H];
        let mut sink = None;
        self.traverse(self.tree.root, &reach, Mode::Train, None, &mut sink);
        // DCFR(1.5, 0, 2): discount old regrets and old averages, then add this iteration's.
        let t = self.iterations as f64;
        let pos = t.powf(1.5) / (t.powf(1.5) + 1.0);
        let gamma = (t / (t + 1.0)).powi(2);
        for i in 0..self.regrets.len() {
            for (r, d) in self.regrets[i].iter_mut().zip(&self.d_regret[i]) {
                *r = *r * if *r > 0.0 { pos } else { 0.5 } + d;
            }
            for (s, d) in self.strat_sum[i].iter_mut().zip(&self.d_strat[i]) {
                *s = *s * gamma + d;
            }
        }
        self.iterations += 1;
    }

    /// Each player's expected result (bb per hand) when everyone plays the average strategy.
    pub fn values(&mut self) -> Vec<f64> {
        let reach = vec![1.0; self.tree.num_players * H];
        let mut sink = None;
        let cfv = self.traverse(self.tree.root, &reach, Mode::Average, None, &mut sink);
        (0..self.tree.num_players).map(|p| self.dot(&cfv[p * H..(p + 1) * H])).collect()
    }

    /// Sum over players of what a best response gains against the average strategy, in bb per
    /// hand (NashConv). Best responses see the full action history, so this is an upper bound.
    pub fn nash_conv(&mut self) -> f64 {
        let values = self.values();
        let mut total = 0.0;
        for p in 0..self.tree.num_players {
            let reach = vec![1.0; self.tree.num_players * H];
            let mut sink = None;
            let cfv = self.traverse(self.tree.root, &reach, Mode::BestResponse(p), None, &mut sink);
            total += self.dot(&cfv[p * H..(p + 1) * H]) - values[p];
        }
        total
    }

    /// Exploitability that respects the charts' information: each player switches, at every chart
    /// node, to the action with the best average value there (over all the histories the node
    /// covers), and we measure what that gains (bb per hand, summed over players). This is the
    /// measure of convergence; `nash_conv` also counts what the chart abstraction itself gives up.
    pub fn local_nash_conv(&mut self) -> f64 {
        let values = self.values();
        let evs = self.action_evs();
        for (i, pol) in self.policy.iter_mut().enumerate() {
            let n = self.tree.infosets[i].actions.len();
            for h in 0..H {
                let best = (0..n).max_by(|&a, &b| evs.ev[i][a * H + h].total_cmp(&evs.ev[i][b * H + h])).unwrap();
                for a in 0..n {
                    pol[a * H + h] = if a == best { 1.0 } else { 0.0 };
                }
            }
        }
        let mut total = 0.0;
        for p in 0..self.tree.num_players {
            let reach = vec![1.0; self.tree.num_players * H];
            let mut sink = None;
            let cfv = self.traverse(self.tree.root, &reach, Mode::Policy(p), None, &mut sink);
            total += self.dot(&cfv[p * H..(p + 1) * H]) - values[p];
        }
        total
    }

    /// Expected value of every action at every info set under the average strategy.
    pub fn action_evs(&mut self) -> ActionEvs {
        let n = self.tree.infosets.len();
        let acts = |i: usize| self.tree.infosets[i].actions.len();
        let mut acc = Some(EvAcc {
            num: (0..n).map(|i| vec![0.0; acts(i) * H]).collect(),
            den: vec![vec![0.0; H]; n],
            num_flat: (0..n).map(|i| vec![0.0; acts(i) * H]).collect(),
            den_flat: vec![0.0; n],
        });
        let reach = vec![1.0; self.tree.num_players * H];
        self.traverse(self.tree.root, &reach, Mode::Average, None, &mut acc);
        let acc = acc.unwrap();
        let ev = (0..n)
            .map(|i| {
                let mut out = vec![0.0; acts(i) * H];
                for a in 0..acts(i) {
                    for h in 0..H {
                        // Weight by how often this hand gets here; hands that never do fall back to
                        // an unweighted average over the histories that lead here.
                        out[a * H + h] = if acc.den[i][h] > 1e-12 {
                            acc.num[i][a * H + h] / acc.den[i][h]
                        } else if acc.den_flat[i] > 1e-15 {
                            acc.num_flat[i][a * H + h] / acc.den_flat[i]
                        } else {
                            0.0
                        };
                    }
                }
                out
            })
            .collect();
        ActionEvs { ev, reach: acc.den }
    }

    fn dot(&self, v: &[f64]) -> f64 {
        v.iter().zip(&self.probs).map(|(a, b)| a * b).sum()
    }

    fn totals(&self, reach: &[f64]) -> Vec<f64> {
        (0..self.tree.num_players).map(|p| self.dot(&reach[p * H..(p + 1) * H])).collect()
    }

    fn traverse(&mut self, node: usize, reach: &[f64], mode: Mode, _parent: Option<usize>, ev: &mut Option<EvAcc>) -> Vec<f64> {
        let np = self.tree.num_players;
        let tree = self.tree;
        match &tree.nodes[node] {
            Node::Fold { committed, winner } => {
                let r = self.totals(reach);
                let pot: f64 = committed.iter().sum();
                let mut out = vec![0.0; np * H];
                for p in 0..np {
                    let others: f64 = (0..np).filter(|&q| q != p).map(|q| r[q]).product();
                    let payoff = if p == *winner { pot - committed[p] } else { -committed[p] };
                    out[p * H..(p + 1) * H].iter_mut().for_each(|x| *x = payoff * others);
                }
                out
            }
            Node::Showdown { committed, a, b, .. } => {
                let r = self.totals(reach);
                let pot: f64 = committed.iter().sum();
                let mut out = vec![0.0; np * H];
                let rest: f64 = (0..np).filter(|&q| q != *a && q != *b).map(|q| r[q]).product();
                for (side, me, opp) in [(0, *a, *b), (1, *b, *a)] {
                    if rest == 0.0 || r[opp] == 0.0 {
                        continue;
                    }
                    let w: Vec<f64> = (0..H).map(|y| self.probs[y] * reach[opp * H + y]).collect();
                    let fac = self.leaf_real[node].as_ref().map_or(&self.ones, |f| &f[side]);
                    for x in 0..H {
                        let row = &self.eq.eq[x * H..(x + 1) * H];
                        let share: f64 = row.iter().zip(&w).map(|(e, wy)| e * wy).sum();
                        out[me * H + x] = rest * (pot * fac[x] * share - committed[me] * r[opp]);
                    }
                }
                for p in (0..np).filter(|&q| q != *a && q != *b) {
                    let others: f64 = (0..np).filter(|&q| q != p).map(|q| r[q]).product();
                    out[p * H..(p + 1) * H].iter_mut().for_each(|x| *x = -committed[p] * others);
                }
                out
            }
            Node::Decision { player, infoset, legal, children } => {
                let (p, i) = (*player, *infoset);
                let strat: Vec<f64> = match mode {
                    Mode::Train => {
                        let mut s = self.current[i].clone();
                        if let Some((a, f)) = self.floor[i] {
                            apply_floor(&mut s, self.tree.infosets[i].actions.len(), a, f);
                        }
                        s
                    }
                    Mode::Policy(q) if q == p => self.policy[i].clone(),
                    _ => self.average_strategy(i),
                };
                let mut out = vec![0.0; np * H];
                let mut child_cfv = Vec::with_capacity(children.len());
                for (k, &child) in children.iter().enumerate() {
                    let a = legal[k];
                    let mut next = reach.to_vec();
                    if mode != Mode::BestResponse(p) {
                        for h in 0..H {
                            next[p * H + h] *= strat[a * H + h];
                        }
                    }
                    let cfv = self.traverse(child, &next, mode, Some(node), ev);
                    for q in (0..np).filter(|&q| q != p) {
                        for h in 0..H {
                            out[q * H + h] += cfv[q * H + h];
                        }
                    }
                    child_cfv.push(cfv);
                }
                // The acting player's value: the strategy's mix, or the best action per hand.
                for h in 0..H {
                    out[p * H + h] = match mode {
                        Mode::BestResponse(br) if br == p => child_cfv.iter().map(|c| c[p * H + h]).fold(f64::NEG_INFINITY, f64::max),
                        _ => children.iter().enumerate().map(|(k, _)| strat[legal[k] * H + h] * child_cfv[k][p * H + h]).sum(),
                    };
                }
                if mode == Mode::Train {
                    for (k, c) in child_cfv.iter().enumerate() {
                        let a = legal[k];
                        for h in 0..H {
                            self.d_regret[i][a * H + h] += c[p * H + h] - out[p * H + h];
                            // With a floor, average the unadjusted strategy: the charts don't show the forced share.
                            let played = if self.floor[i].is_some() { self.current[i][a * H + h] } else { strat[a * H + h] };
                            self.d_strat[i][a * H + h] += reach[p * H + h] * played;
                        }
                    }
                }
                if let Some(acc) = ev.as_mut() {
                    let r = self.totals(reach);
                    let others: f64 = (0..np).filter(|&q| q != p).map(|q| r[q]).product();
                    acc.den_flat[i] += others;
                    for h in 0..H {
                        acc.den[i][h] += reach[p * H + h] * others;
                    }
                    for (k, c) in child_cfv.iter().enumerate() {
                        let a = legal[k];
                        for h in 0..H {
                            acc.num[i][a * H + h] += reach[p * H + h] * c[p * H + h];
                            acc.num_flat[i][a * H + h] += c[p * H + h];
                        }
                    }
                }
                out
            }
        }
    }
}

struct EvAcc {
    num: Vec<Vec<f64>>,
    den: Vec<Vec<f64>>,
    num_flat: Vec<Vec<f64>>,
    den_flat: Vec<f64>,
}

/// Raises action `a` to at least `floor` for every hand of a strategy laid out [action * H + hand],
/// scaling the other actions down so each hand still sums to 1.
fn apply_floor(s: &mut [f64], n: usize, a: usize, floor: f64) {
    for h in 0..H {
        let p = s[a * H + h];
        if p >= floor {
            continue;
        }
        let scale = if p < 1.0 { (1.0 - floor) / (1.0 - p) } else { 0.0 };
        for b in (0..n).filter(|&b| b != a) {
            s[b * H + h] *= scale;
        }
        s[a * H + h] = floor;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::{all_classes, class_probs};
    use crate::game::build_push_fold;

    #[test]
    fn action_floor_keeps_each_hand_summing_to_one() {
        // Two actions, every hand plays action 0 always; a 1% floor on action 1.
        let mut s = vec![1.0; H];
        s.extend(vec![0.0; H]);
        apply_floor(&mut s, 2, 1, 0.01);
        assert!((s[0] - 0.99).abs() < 1e-12 && (s[H] - 0.01).abs() < 1e-12);
        // Already above the floor: unchanged.
        let mut t = vec![0.5; 2 * H];
        apply_floor(&mut t, 2, 1, 0.01);
        assert!(t.iter().all(|&x| x == 0.5));
    }

    #[test]
    fn heads_up_push_fold_matches_known_nash() {
        let classes = all_classes();
        let eq = EquityTable::compute(&classes, 3000);
        let tree = build_push_fold(10.0);
        let probs = class_probs(&classes);
        let model = crate::realization::Model::new(&tree.real_keys, &classes, None);
        let mut s = Solver::new(&tree, &eq, probs.clone(), model);
        for _ in 0..400 {
            s.iterate();
        }
        let push = s.average_strategy(0);
        let call = s.average_strategy(1);
        let share = |st: &[f64]| (0..H).map(|h| probs[h] * st[H + h]).sum::<f64>();
        let idx = |n: &str| classes.iter().position(|c| c.name() == n).unwrap();
        // Published heads-up Nash at 10bb: SB shoves ~58%, BB calls ~37% (small differences come
        // from ignoring card removal and Monte Carlo equities).
        let (p, c) = (share(&push), share(&call));
        assert!((0.50..0.66).contains(&p), "push share {p:.3}");
        assert!((0.30..0.44).contains(&c), "call share {c:.3}");
        assert!(push[H + idx("AA")] > 0.99 && call[H + idx("AA")] > 0.99);
        assert!(call[H + idx("32o")] < 0.01);
        let nc = s.nash_conv();
        assert!(nc < 0.01, "NashConv {nc} bb/hand");
    }
}

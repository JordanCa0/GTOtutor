//! Equity realization: the share of its raw equity a hand turns into pot share once it sees a
//! flop.
//!
//! Model: realization = f(q) × g(class).
//! - q is where the hand ranks inside its own range at that flop (0 = weakest, 1 = strongest), by
//!   its equity against the opponent's range. f is a curve per pot type, position and preflop role
//!   ("srp|oop_caller", …). Ranking within the range, rather than the class itself, is what lets a
//!   weak hand that wanders into a strong range (a 3-bet, say) still realize like a weak hand.
//! - g is a playability multiplier per hand class (suited, connected, …), the same in every spot.
//!
//! Both start from a rough hand-written model; `calibrateRealization.ts` measures them from flop
//! solves and writes a JSON file that replaces them.

use crate::cards::HandClass;
use crate::game::RealKey;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Points per curve, at q = (i + 0.5) / BINS.
pub const BINS: usize = 10;

#[derive(Serialize, Deserialize, Default)]
// Older per-class files (before the rank model) have other keys: reject them rather than silently
// falling back to the built-in curves.
#[serde(deny_unknown_fields)]
pub struct RealizationFile {
    /// "<pot type>|<side>_<role>" (e.g. "srp|oop_caller") -> realization at each q point.
    pub curves: HashMap<String, Vec<f64>>,
    /// Hand class -> playability multiplier (mean 1 over the hands measured).
    pub playability: HashMap<String, f64>,
}

pub fn curve_name(key: &RealKey) -> String {
    let side = if key.in_position { "ip" } else { "oop" };
    format!("{}|{side}_{}", key.pot_type, if key.aggressor { "raiser" } else { "caller" })
}

/// Average realization before ranking within the range. Rough published-ballpark values:
/// position matters most in deep single-raised pots and least when the stack-to-pot ratio is low.
fn level(key: &RealKey) -> f64 {
    let (ip, oop) = match key.pot_type.as_str() {
        "srp" => (1.04, 0.86),
        "3bp" => (1.02, 0.92),
        "4bp" => (1.0, 0.96),
        "limp" => (1.0, 0.88),
        "iso" => (1.02, 0.88),
        _ => (1.0, 0.94),
    };
    (if key.in_position { ip } else { oop }) * if key.aggressor { 1.04 } else { 0.97 }
}

/// Hand shape: suited and connected hands play better than their raw equity; disconnected
/// offsuit hands and small pairs worse.
fn shape(c: &HandClass) -> f64 {
    if c.is_pair() {
        return if c.hi >= 8 { 1.03 } else { 0.97 };
    }
    let gap = c.hi - c.lo - 1;
    let mut f: f64 = 1.0;
    if c.suited {
        f += 0.07;
    }
    f += match gap {
        0 => 0.04,
        1 => 0.02,
        2 => 0.0,
        _ => -0.04,
    };
    if !c.suited && c.hi < 8 {
        f -= 0.06; // offsuit, no broadway card
    }
    f
}

pub struct Model {
    /// Per realization key of the tree (index 0 = all-in, no curve).
    curves: Vec<Option<Vec<f64>>>,
    playability: Vec<f64>,
}

impl Model {
    pub fn new(keys: &[Option<RealKey>], classes: &[HandClass], file: Option<&RealizationFile>) -> Model {
        let curves = keys
            .iter()
            .map(|k| {
                k.as_ref().map(|key| {
                    file.and_then(|f| f.curves.get(&curve_name(key)))
                        .filter(|c| c.len() == BINS)
                        .cloned()
                        // Default: weaker hands in the range realize less (0.7x to 1.3x the level).
                        .unwrap_or_else(|| (0..BINS).map(|i| level(key) * (0.7 + 0.6 * (i as f64 + 0.5) / BINS as f64)).collect())
                })
            })
            .collect();
        let playability = classes
            .iter()
            .map(|c| file.and_then(|f| f.playability.get(&c.name()).copied()).unwrap_or_else(|| shape(c)))
            .collect();
        Model { curves, playability }
    }

    /// Realization per class at a flop leaf, given each class's rank `q` within its own range.
    /// Key 0 (all-in) realizes exactly its equity.
    pub fn factors(&self, key: usize, q: &[f64]) -> Vec<f64> {
        match &self.curves[key] {
            None => vec![1.0; q.len()],
            Some(curve) => q.iter().zip(&self.playability).map(|(&q, &g)| interpolate(curve, q) * g).collect(),
        }
    }
}

/// Linear interpolation between curve points at (i + 0.5) / BINS, flat beyond the ends.
fn interpolate(curve: &[f64], q: f64) -> f64 {
    let x = (q * BINS as f64 - 0.5).clamp(0.0, (BINS - 1) as f64);
    let i = (x.floor() as usize).min(BINS - 2);
    let t = x - i as f64;
    curve[i] * (1.0 - t) + curve[i + 1] * t
}

/// Each class's rank inside a range (0 = weakest, 1 = strongest, mid-rank for ties), ordering
/// by `equity` and weighting by `weight`. An empty range counts every class equally.
pub fn rank_in_range(equity: &[f64], weight: &[f64]) -> Vec<f64> {
    let total: f64 = weight.iter().sum();
    let w: Vec<f64> = if total > 0.0 { weight.iter().map(|x| x / total).collect() } else { vec![1.0 / weight.len() as f64; weight.len()] };
    let mut order: Vec<usize> = (0..equity.len()).collect();
    order.sort_by(|&a, &b| equity[a].total_cmp(&equity[b]));
    let mut q = vec![0.0; equity.len()];
    let mut below = 0.0;
    let mut i = 0;
    while i < order.len() {
        // Group exact ties so they share a rank.
        let mut j = i;
        let mut tied = 0.0;
        while j < order.len() && equity[order[j]] == equity[order[i]] {
            tied += w[order[j]];
            j += 1;
        }
        for &k in &order[i..j] {
            q[k] = below + tied / 2.0;
        }
        below += tied;
        i = j;
    }
    q
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_and_interpolation() {
        let q = rank_in_range(&[0.2, 0.8, 0.5, 0.5], &[1.0, 1.0, 1.0, 1.0]);
        assert_eq!(q, vec![0.125, 0.875, 0.5, 0.5]);
        // Weight matters: a heavy weak hand pushes the others up.
        let q = rank_in_range(&[0.2, 0.8], &[3.0, 1.0]);
        assert_eq!(q, vec![0.375, 0.875]);
        let curve: Vec<f64> = (0..BINS).map(|i| i as f64).collect();
        assert_eq!(interpolate(&curve, 0.0), 0.0);
        assert_eq!(interpolate(&curve, 1.0), 9.0);
        assert!((interpolate(&curve, 0.5) - 4.5).abs() < 1e-12);
    }
}

//! Class-vs-class all-in equity, estimated by Monte Carlo and cached on disk.

use crate::cards::{eval7, Card, HandClass, NUM_CLASSES};
use rayon::prelude::*;
use std::path::Path;

/// `eq[a * 169 + b]` = share of the pot class `a` wins against class `b` (ties count half),
/// averaged over all non-conflicting combos and boards.
pub struct EquityTable {
    pub eq: Vec<f64>,
}

impl EquityTable {
    pub fn load_or_compute(classes: &[HandClass], samples: u32, cache: &Path) -> EquityTable {
        if let Ok(text) = std::fs::read_to_string(cache) {
            if let Ok(eq) = serde_json::from_str::<Vec<f64>>(&text) {
                if eq.len() == NUM_CLASSES * NUM_CLASSES {
                    return EquityTable { eq };
                }
            }
        }
        let start = std::time::Instant::now();
        let table = Self::compute(classes, samples);
        if let Some(dir) = cache.parent() {
            std::fs::create_dir_all(dir).ok();
        }
        std::fs::write(cache, serde_json::to_vec(&table.eq).unwrap()).ok();
        eprintln!("equity table: {samples} samples per matchup in {:.1}s (cached to {})", start.elapsed().as_secs_f64(), cache.display());
        table
    }

    pub fn compute(classes: &[HandClass], samples: u32) -> EquityTable {
        let combos: Vec<Vec<[Card; 2]>> = classes.iter().map(|c| c.combo_list()).collect();
        let pairs: Vec<(usize, usize)> = (0..NUM_CLASSES).flat_map(|a| (a..NUM_CLASSES).map(move |b| (a, b))).collect();
        let results: Vec<f64> = pairs
            .par_iter()
            .map(|&(a, b)| matchup(&combos[a], &combos[b], samples, (a * 1000 + b) as u64))
            .collect();
        let mut eq = vec![0.0; NUM_CLASSES * NUM_CLASSES];
        for (&(a, b), &e) in pairs.iter().zip(&results) {
            eq[a * NUM_CLASSES + b] = e;
            eq[b * NUM_CLASSES + a] = 1.0 - e;
        }
        EquityTable { eq }
    }
}

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn matchup(a: &[[Card; 2]], b: &[[Card; 2]], samples: u32, seed: u64) -> f64 {
    let mut rng = Rng(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1);
    let mut won = 0.0;
    let mut done = 0u32;
    while done < samples {
        let ha = a[rng.below(a.len())];
        let hb = b[rng.below(b.len())];
        let mut used = 0u64;
        let mut clash = false;
        for c in ha.iter().chain(hb.iter()) {
            clash |= used & (1 << c) != 0;
            used |= 1 << c;
        }
        if clash {
            continue; // e.g. AKs vs AKs sharing a card: draw again, so combos stay uniform
        }
        let mut board = [0u8; 5];
        let mut n = 0;
        while n < 5 {
            let c = rng.below(52) as u8;
            if used & (1 << c) == 0 {
                used |= 1 << c;
                board[n] = c;
                n += 1;
            }
        }
        let sa = eval7(&[ha[0], ha[1], board[0], board[1], board[2], board[3], board[4]]);
        let sb = eval7(&[hb[0], hb[1], board[0], board[1], board[2], board[3], board[4]]);
        won += if sa > sb { 1.0 } else if sa == sb { 0.5 } else { 0.0 };
        done += 1;
    }
    won / samples as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cards::all_classes;

    #[test]
    fn known_matchups() {
        let classes = all_classes();
        let idx = |n: &str| classes.iter().position(|c| c.name() == n).unwrap();
        let combos: Vec<_> = classes.iter().map(|c| c.combo_list()).collect();
        let eq = |x: &str, y: &str| matchup(&combos[idx(x)], &combos[idx(y)], 60_000, 7);
        // Reference values from standard equity calculators.
        let checks = [("AA", "KK", 0.82), ("AKo", "22", 0.47), ("AKs", "QQ", 0.46), ("72o", "AA", 0.12), ("JTs", "AKo", 0.41), ("AA", "AA", 0.5)];
        for (x, y, want) in checks {
            let got = eq(x, y);
            assert!((got - want).abs() < 0.015, "{x} vs {y}: got {got:.3}, want ~{want}");
        }
    }
}

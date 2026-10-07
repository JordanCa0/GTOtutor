//! Cards, the 169 starting-hand classes, and a 7-card hand evaluator.

pub const RANKS: &[u8] = b"23456789TJQKA";
pub const NUM_CLASSES: usize = 169;

/// A card is rank * 4 + suit (rank 0 = deuce, 12 = ace).
pub type Card = u8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HandClass {
    /// High rank first; equal for pairs.
    pub hi: u8,
    pub lo: u8,
    pub suited: bool,
}

impl HandClass {
    pub fn name(&self) -> String {
        let (h, l) = (RANKS[self.hi as usize] as char, RANKS[self.lo as usize] as char);
        if self.hi == self.lo {
            format!("{h}{l}")
        } else {
            format!("{h}{l}{}", if self.suited { 's' } else { 'o' })
        }
    }

    pub fn is_pair(&self) -> bool {
        self.hi == self.lo
    }

    pub fn combos(&self) -> u32 {
        if self.is_pair() {
            6
        } else if self.suited {
            4
        } else {
            12
        }
    }

    /// Every concrete two-card combo of this class.
    pub fn combo_list(&self) -> Vec<[Card; 2]> {
        let mut out = Vec::new();
        for s1 in 0..4u8 {
            for s2 in 0..4u8 {
                let ok = if self.is_pair() { s1 < s2 } else if self.suited { s1 == s2 } else { s1 != s2 };
                if ok {
                    out.push([self.hi * 4 + s1, self.lo * 4 + s2]);
                }
            }
        }
        out
    }
}

/// All 169 classes, in a fixed order (pairs, suited, offsuit by descending ranks).
pub fn all_classes() -> Vec<HandClass> {
    let mut v = Vec::with_capacity(NUM_CLASSES);
    for r in (0..13u8).rev() {
        v.push(HandClass { hi: r, lo: r, suited: false });
    }
    for suited in [true, false] {
        for hi in (0..13u8).rev() {
            for lo in (0..hi).rev() {
                v.push(HandClass { hi, lo, suited });
            }
        }
    }
    v
}

/// Chance of being dealt each class (combos / 1326).
pub fn class_probs(classes: &[HandClass]) -> Vec<f64> {
    classes.iter().map(|c| c.combos() as f64 / 1326.0).collect()
}

/// Strength of the best 5-card hand among 7 cards; higher is better.
pub fn eval7(cards: &[Card; 7]) -> u32 {
    let mut suit_masks = [0u16; 4];
    let mut counts = [0u8; 13];
    for &c in cards {
        suit_masks[(c & 3) as usize] |= 1 << (c >> 2);
        counts[(c >> 2) as usize] += 1;
    }
    for &m in &suit_masks {
        if m.count_ones() >= 5 {
            if let Some(top) = straight_top(m) {
                return (8 << 20) | top;
            }
            return (5 << 20) | top_bits(m, 5);
        }
    }
    let all = suit_masks.iter().fold(0, |a, &m| a | m);
    // Rank masks grouped by how many of each rank there are.
    let (mut quads, mut trips, mut pairs, mut singles) = (0u16, 0u16, 0u16, 0u16);
    for r in 0..13 {
        match counts[r] {
            4 => quads |= 1 << r,
            3 => trips |= 1 << r,
            2 => pairs |= 1 << r,
            1 => singles |= 1 << r,
            _ => {}
        }
    }
    let high = |m: u16| 15 - m.leading_zeros(); // highest set rank; m must be non-zero
    if quads != 0 {
        let q = high(quads);
        return (7 << 20) | (q << 4) | high(all & !(1 << q));
    }
    if trips != 0 {
        let t = high(trips);
        let rest = (trips & !(1 << t)) | pairs;
        if rest != 0 {
            return (6 << 20) | (t << 4) | high(rest);
        }
    }
    if let Some(top) = straight_top(all) {
        return (4 << 20) | top;
    }
    if trips != 0 {
        return (3 << 20) | (high(trips) << 8) | top_bits(singles, 2);
    }
    if pairs.count_ones() >= 2 {
        let p1 = high(pairs);
        let p2 = high(pairs & !(1 << p1));
        let rest = (pairs & !(1 << p1) & !(1 << p2)) | singles;
        return (2 << 20) | (p1 << 8) | (p2 << 4) | high(rest);
    }
    if pairs != 0 {
        return (1 << 20) | (high(pairs) << 12) | top_bits(singles, 3);
    }
    top_bits(singles, 5)
}

fn top_bits(mask: u16, n: usize) -> u32 {
    let mut out = 0u32;
    let mut left = n;
    for r in (0..13u32).rev() {
        if left == 0 {
            break;
        }
        if mask & (1 << r) != 0 {
            out = (out << 4) | r;
            left -= 1;
        }
    }
    out
}

/// Highest card of a straight in `mask`, if any (the wheel counts as 5-high = rank 3).
fn straight_top(mask: u16) -> Option<u32> {
    for top in (4..13u32).rev() {
        let need = 0b11111u16 << (top - 4);
        if mask & need == need {
            return Some(top);
        }
    }
    let wheel = 0b1_0000_0000_1111u16;
    (mask & wheel == wheel).then_some(3)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(s: &str) -> Vec<Card> {
        s.as_bytes()
            .chunks(2)
            .map(|c| {
                let r = RANKS.iter().position(|&x| x == c[0]).unwrap() as u8;
                let s = b"cdhs".iter().position(|&x| x == c[1]).unwrap() as u8;
                r * 4 + s
            })
            .collect()
    }

    fn ev(s: &str) -> u32 {
        let v = parse(s);
        eval7(&[v[0], v[1], v[2], v[3], v[4], v[5], v[6]])
    }

    #[test]
    fn class_counts() {
        let c = all_classes();
        assert_eq!(c.len(), 169);
        assert_eq!(c.iter().map(|h| h.combos()).sum::<u32>(), 1326);
        assert!(c.iter().all(|h| h.combo_list().len() == h.combos() as usize));
        assert_eq!(c[0].name(), "AA");
        assert!(c.iter().any(|h| h.name() == "T9s") && c.iter().any(|h| h.name() == "72o"));
    }

    #[test]
    fn hand_order() {
        let order = [
            "2c3d5h7s9cJdKh", // high card
            "2c2d5h7s9cJdKh", // pair
            "2c2d5h5s9cJdKh", // two pair
            "2c2d2h7s9cJdKh", // trips
            "Ac2d3h4s5cJdKh", // wheel
            "6c2d3h4s5cJdKh", // 6-high straight
            "2c4c6c8cTcJdKh", // flush
            "2c2d2h5s5cJdKh", // full house
            "2c2d2h2s9cJdKh", // quads
            "Ac2c3c4c5cJdKh", // steel wheel
            "TcJcQcKcAc2d3h", // royal
        ];
        for w in order.windows(2) {
            assert!(ev(w[0]) < ev(w[1]), "{} should lose to {}", w[0], w[1]);
        }
        // Kickers and the board playing.
        assert!(ev("AcKd5h7s9c2d3h") > ev("AcQd5h7s9c2d3h"));
        assert_eq!(ev("2c3dAhKsQcJdTh"), ev("4c5dAhKsQcJdTh"));
        // Two trips make a full house with the lower trips as the pair.
        assert_eq!(ev("3c3d3h2s2c2dAh"), ev("3c3d3h2s2cKdAh"));
        assert!(ev("3c3d3h2s2c2dAh") > ev("2c2d2hAsAc5d9h"));
        // Three pairs: the third pair can be the kicker.
        assert!(ev("AcAdKhKs5c5dQh") > ev("AcAdKhKs5c5d4h"));
    }
}

//! E26: each Pigeon's last prompt, kept in its lane's cache so the next ask
//! evaluates only what follows the part they share.
//!
//! A lane keeps up to `KEEP` prompts, one per Pigeon, each in a sequence of
//! its own past the `SEQS` that requests run in. A new request shares the
//! longest common run of tokens with its own Pigeon's kept prompt — llama-
//! server's method, so nothing here knows where a template's shots end — and
//! evaluates the rest. Only the text before a prompt's first picture is kept.
//!
//! A kept prompt belongs to one Pigeon (one adapter on one base) and is held
//! by a weak reference: a Pigeon unloaded and loaded again is a new Pigeon,
//! and never matches what its old self left. The cells kept are bounded by
//! `prefix_cache_tokens` per lane, least recently used first out; a request
//! that needs the room takes it before it waits (lanes.rs).
//!
//! This file is the bookkeeping only; lanes.rs moves the cells.

use std::sync::{Arc, Weak};

/// Prompts a lane keeps at once (sequences past the requests').
pub const KEEP: usize = 4;
/// Fewer shared tokens than this are evaluated again rather than shared.
pub const MIN_REUSE: usize = 16;

pub struct Kept<T> {
    pub seq: i32,
    owner: Weak<T>,
    pub tokens: Vec<i32>,
    used: u64,
}

pub struct Store<T> {
    free: Vec<i32>,
    pub kept: Vec<Kept<T>>,
    budget: usize,
    tick: u64,
}

/// How many leading tokens two prompts share.
pub fn common(a: &[i32], b: &[i32]) -> usize {
    a.iter().zip(b).take_while(|(x, y)| x == y).count()
}

impl<T> Store<T> {
    /// Sequences `first .. first + KEEP` are the store's; `budget` cells in all.
    pub fn new(first: i32, budget: usize) -> Store<T> {
        Store { free: (first..first + KEEP as i32).rev().collect(), kept: Vec::new(), budget, tick: 0 }
    }

    /// Cells held now.
    pub fn cells(&self) -> usize {
        self.kept.iter().map(|k| k.tokens.len()).sum()
    }

    /// The Pigeons whose prompts are kept, by address (lanes.rs's key), the
    /// ones still loaded only.
    pub fn owners(&self) -> Vec<usize> {
        self.kept.iter().filter(|k| k.owner.strong_count() > 0).map(|k| k.owner.as_ptr() as usize).collect()
    }

    fn evict(&mut self, i: usize) -> i32 {
        let k = self.kept.remove(i);
        self.free.push(k.seq);
        k.seq
    }

    /// Prompts whose Pigeon is gone: their sequences, to forget.
    pub fn purge(&mut self) -> Vec<i32> {
        let mut gone = Vec::new();
        while let Some(i) = self.kept.iter().position(|k| k.owner.strong_count() == 0) {
            gone.push(self.evict(i));
        }
        gone
    }

    /// Everything, for a request that needs the room: the sequences to forget.
    pub fn drop_all(&mut self) -> Vec<i32> {
        let mut gone = Vec::new();
        while !self.kept.is_empty() {
            gone.push(self.evict(0));
        }
        gone
    }

    /// What `owner`'s kept prompt gives a new one: its sequence and how many
    /// leading tokens to share. `whole` is true when these tokens are the
    /// whole prompt; its last token is then always evaluated again, for the
    /// logits the first answer token is read from.
    pub fn reuse(&mut self, owner: &Arc<T>, tokens: &[i32], whole: bool) -> Option<(i32, usize)> {
        self.tick += 1;
        let tick = self.tick;
        let k = self.kept.iter_mut().find(|k| std::ptr::eq(k.owner.as_ptr(), Arc::as_ptr(owner)) && k.owner.strong_count() > 0)?;
        let most = if whole { tokens.len().saturating_sub(1) } else { tokens.len() };
        let n = common(&k.tokens, tokens).min(most);
        if n < MIN_REUSE {
            return None;
        }
        k.used = tick;
        Some((k.seq, n))
    }

    /// Where to keep `tokens` as `owner`'s prompt: the sequence, and every
    /// sequence to forget first (its old one, and any evicted to make room).
    /// None when it is too short or larger than the whole budget; `owner`'s
    /// older prompt is then left as it was.
    pub fn keep(&mut self, owner: &Arc<T>, tokens: Vec<i32>) -> Option<(i32, Vec<i32>)> {
        if tokens.len() < MIN_REUSE || tokens.len() > self.budget {
            return None;
        }
        self.tick += 1;
        let mut forget = self.purge();
        if let Some(i) = self.kept.iter().position(|k| std::ptr::eq(k.owner.as_ptr(), Arc::as_ptr(owner))) {
            forget.push(self.evict(i));
        }
        while self.free.is_empty() || self.cells() + tokens.len() > self.budget {
            let Some(oldest) = self.kept.iter().enumerate().min_by_key(|(_, k)| k.used).map(|(i, _)| i) else { break };
            forget.push(self.evict(oldest));
        }
        let seq = self.free.pop()?;
        self.kept.push(Kept { seq, owner: Arc::downgrade(owner), tokens, used: self.tick });
        Some((seq, forget))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(n: usize, from: i32) -> Vec<i32> {
        (from..from + n as i32).collect()
    }

    #[test]
    fn a_new_prompt_shares_its_pigeons_kept_prefix_and_keeps_its_last_token_to_evaluate() {
        let a = Arc::new(());
        let mut s: Store<()> = Store::new(4, 2048);
        assert!(s.reuse(&a, &toks(100, 0), true).is_none(), "nothing kept yet");
        let (seq, forget) = s.keep(&a, toks(100, 0)).unwrap();
        assert!((4..8).contains(&seq) && forget.is_empty());
        // The same prompt again: all but the last token.
        assert_eq!(s.reuse(&a, &toks(100, 0), true), Some((seq, 99)));
        // A prompt that parts at token 90: 90 shared.
        let mut other = toks(100, 0);
        other[90] = -1;
        assert_eq!(s.reuse(&a, &other, true), Some((seq, 90)));
        // Text before a picture is not the whole prompt: all of it may be shared.
        assert_eq!(s.reuse(&a, &toks(100, 0), false), Some((seq, 100)));
        // Too little in common: evaluated again.
        assert!(s.reuse(&a, &toks(100, 5), true).is_none());
    }

    #[test]
    fn another_pigeon_never_shares_and_a_reloaded_pigeon_is_a_new_one() {
        let a = Arc::new(());
        let b = Arc::new(());
        let mut s: Store<()> = Store::new(4, 2048);
        s.keep(&a, toks(50, 0)).unwrap();
        assert!(s.reuse(&b, &toks(50, 0), true).is_none(), "a different Pigeon (another adapter)");
        drop(a);
        let again = Arc::new(());
        assert!(s.reuse(&again, &toks(50, 0), true).is_none(), "unloaded and loaded again");
        assert_eq!(s.purge().len(), 1, "its old prompt is forgotten");
        assert_eq!(s.cells(), 0);
    }

    #[test]
    fn the_budget_holds_least_recently_used_first_out() {
        let ps: Vec<Arc<()>> = (0..3).map(|_| Arc::new(())).collect();
        let mut s: Store<()> = Store::new(4, 250);
        let s0 = s.keep(&ps[0], toks(100, 0)).unwrap().0;
        s.keep(&ps[1], toks(100, 1000)).unwrap();
        // ps[0] used again, so ps[1] is the oldest when room is needed.
        assert!(s.reuse(&ps[0], &toks(100, 0), true).is_some());
        let (_, forget) = s.keep(&ps[2], toks(100, 2000)).unwrap();
        assert_eq!(forget.len(), 1, "one evicted for room");
        assert!(s.reuse(&ps[1], &toks(100, 1000), true).is_none(), "ps[1] was evicted");
        assert_eq!(s.reuse(&ps[0], &toks(100, 0), true).map(|x| x.0), Some(s0));
        assert!(s.cells() <= 250);
        // Larger than the whole budget: not kept, and nothing is evicted for it.
        assert!(s.keep(&ps[1], toks(300, 0)).is_none());
        assert_eq!(s.kept.len(), 2);
        // A Pigeon's new prompt replaces its old one in the same sequence.
        let (seq, forget) = s.keep(&ps[0], toks(120, 0)).unwrap();
        assert!(forget.contains(&s0) && seq == s0, "{seq} {forget:?}");
        // drop_all hands back every sequence.
        assert_eq!(s.drop_all().len(), 2);
        assert_eq!(s.cells(), 0);
    }

    /// The lane prefers an idle lane that keeps a Pigeon's prompt, so the
    /// store says whose prompts it holds, and an unloaded Pigeon's no longer.
    #[test]
    fn owners_names_the_pigeons_whose_prompts_are_kept_while_they_are_loaded() {
        let a = Arc::new(());
        let b = Arc::new(());
        let mut s: Store<()> = Store::new(4, 2048);
        assert!(s.owners().is_empty());
        s.keep(&a, toks(50, 0)).unwrap();
        s.keep(&b, toks(50, 100)).unwrap();
        let mut got = s.owners();
        got.sort_unstable();
        let mut want = vec![Arc::as_ptr(&a) as usize, Arc::as_ptr(&b) as usize];
        want.sort_unstable();
        assert_eq!(got, want);
        drop(b);
        assert_eq!(s.owners(), vec![Arc::as_ptr(&a) as usize], "an unloaded Pigeon is not an owner");
    }

    #[test]
    fn never_more_than_keep_prompts_at_once() {
        let ps: Vec<Arc<()>> = (0..KEEP + 2).map(|_| Arc::new(())).collect();
        let mut s: Store<()> = Store::new(4, 1 << 20);
        let mut seqs = std::collections::BTreeSet::new();
        for (i, p) in ps.iter().enumerate() {
            let (seq, _) = s.keep(p, toks(20, i as i32 * 100)).unwrap();
            seqs.insert(seq);
        }
        assert_eq!(s.kept.len(), KEEP);
        assert!(seqs.iter().all(|q| (4..4 + KEEP as i32).contains(q)), "{seqs:?}");
    }
}

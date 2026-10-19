//! How much of this Mac a model may have.
//!
//! One number is read and everything else is arithmetic on it. The number is
//! `hw.memsize` from `sysctl`; the arithmetic is the rule Loft applies
//! (`hardware.rs` there): three quarters of RAM is the budget the GPU may
//! commit to, and of that a single loaded model may take 85% for weights plus
//! cache, leaving the rest for the app, the webview and whatever else is open.
//!
//! Every field is an ESTIMATE and is named so. We are not asking Metal what it
//! will really give us; we are applying a rule of thumb that has held on the
//! machines this family has run on. If the real value is ever queried instead,
//! the wording in the first-run sheet changes from "fits" to "measured" — not
//! before.
//!
//! Nothing here touches the network, a path or a model; the manifest supplies
//! what each model needs, this file says whether the machine has it.

use serde::Serialize;
use std::sync::OnceLock;

/// The 75% rule.
const BUDGET_NUM: u64 = 3;
const BUDGET_DEN: u64 = 4;
/// Share of the budget one loaded model may commit (Loft `SINGLE_MODEL_FRACTION`).
const SHARE_PERCENT: u64 = 85;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct Budget {
    /// Physical RAM, in MB.
    pub total_mb: u64,
    /// 75% of it: what the GPU may commit, estimated.
    pub budget_mb: u64,
    /// 85% of the budget: what the models together may take, estimated.
    pub share_mb: u64,
}

pub fn budget_from(total_mb: u64) -> Budget {
    let budget_mb = total_mb * BUDGET_NUM / BUDGET_DEN;
    Budget { total_mb, budget_mb, share_mb: budget_mb * SHARE_PERCENT / 100 }
}

/// Whether this machine can hold the model. From Patch v10 there is one: the
/// planner's Qwen3.5 2B left the app (2026-10-14), and every Pigeon in his
/// nest runs on Qwen3-VL 2B.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Fit {
    Fits,
    None,
}

/// `need_mb` is what the model holds resident (weights plus context), from
/// the manifest. Pure, so it is tested with numbers rather than machines.
pub fn plan_fit(need_mb: u64, share_mb: u64) -> Fit {
    if need_mb <= share_mb {
        Fit::Fits
    } else {
        Fit::None
    }
}

/// "Room to spare" means the models take no more than half the share — the
/// wording the first-run sheet uses, decided in one place.
pub fn has_spare(need_mb: u64, share_mb: u64) -> bool {
    need_mb * 2 <= share_mb
}

/// Physical RAM in MB, or None where it cannot be read. Cached: the sheet, the
/// rail and every wake ask, and the answer does not change while we run.
pub fn total_ram_mb() -> Option<u64> {
    static RAM: OnceLock<Option<u64>> = OnceLock::new();
    *RAM.get_or_init(read_hw_memsize)
}

#[cfg(target_os = "macos")]
fn read_hw_memsize() -> Option<u64> {
    let out = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "hw.memsize"])
        .output()
        .ok()?;
    let bytes: u64 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
    Some(bytes / (1024 * 1024))
}

#[cfg(not(target_os = "macos"))]
fn read_hw_memsize() -> Option<u64> {
    // Linux: /proc/meminfo's MemTotal is in kB. Anything else: unknown.
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    let line = text.lines().find(|l| l.starts_with("MemTotal:"))?;
    let kb: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
    Some(kb / 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sixteen_gb_budgets_12288_and_shares_10444() {
        let b = budget_from(16384);
        assert_eq!(b.budget_mb, 12288);
        assert_eq!(b.share_mb, 10444);
    }

    #[test]
    fn the_pigeon_model_fits_on_sixteen_gb_with_room_to_spare() {
        let b = budget_from(16384);
        assert_eq!(plan_fit(2150 + 33, b.share_mb), Fit::Fits);
        assert!(has_spare(2150 + 33, b.share_mb));
    }

    /// 4 GB → budget 3072 → share 2611: the 2150 MB model fits, not with room
    /// to spare. 2 GB → share 1305 holds nothing: the rule is arithmetic, not a
    /// feeling about small Macs.
    #[test]
    fn four_gb_holds_the_model_and_two_gb_holds_nothing() {
        let b = budget_from(4096);
        assert_eq!(plan_fit(2150, b.share_mb), Fit::Fits);
        assert!(!has_spare(2150, b.share_mb), "2150 of 2611 is not room to spare");
        assert_eq!(plan_fit(2150, budget_from(2048).share_mb), Fit::None);
    }

    /// Absence is a skipped test: on a machine where the read fails this
    /// says so and passes, the same rule the tesseract tests keep.
    #[test]
    fn ram_reads_as_a_sensible_number_where_it_reads_at_all() {
        match total_ram_mb() {
            Some(mb) => assert!(mb >= 1024 && mb <= 4 * 1024 * 1024, "{mb} MB?"),
            None => eprintln!("(skipped: RAM could not be read here)"),
        }
    }
}

//! E12: the engine makes the same picture from the same frames as the Pigeon
//! app's capture helper, byte for byte. Runs Eye's own `compose` (the crop,
//! stack and JPEG code `watch` uses) beside the engine's. Skips unless set:
//!
//!   PIGEON_EYE              a pigeon-eye built from this tree's eye/Eye.swift
//!   PIGEON_SEED_RUN_HOLDOUT the Seed Run holdout (its boards are the frames)

use std::path::PathBuf;
use std::process::Command;

use serde_json::{json, Value};

#[test]
fn the_engine_makes_eyes_picture_from_the_same_frames() {
    let (Some(eye), Some(holdout)) = (std::env::var_os("PIGEON_EYE").map(PathBuf::from), std::env::var_os("PIGEON_SEED_RUN_HOLDOUT")) else {
        eprintln!("skipped: set PIGEON_EYE and PIGEON_SEED_RUN_HOLDOUT");
        return;
    };
    let boards: Vec<String> = std::fs::read_to_string(holdout)
        .unwrap()
        .lines()
        .take(3)
        .map(|l| serde_json::from_str::<Value>(l).unwrap()["image"].as_str().unwrap().to_string())
        .collect();
    let out = std::env::temp_dir().join(format!("pigeon-engine-frames-{}.jpg", std::process::id()));
    let cases: Vec<(Option<&str>, usize, u64)> = vec![
        (None, 1, 256),
        (Some("0.242,0.1509,0.5171,0.8228"), 1, 211),
        (Some("0.1,0.2,0.5,0.5"), 2, 128),
        (Some("-0.1,0,0.6,1"), 3, 256),
    ];
    for (crop, stack, max_side) in cases {
        let files = &boards[..stack];
        let mut args: Vec<String> = vec!["compose".into(), "--out".into(), out.to_string_lossy().into()];
        if let Some(c) = crop {
            args.extend(["--crop".into(), c.into()]);
        }
        args.extend(files.iter().cloned());
        let ran = Command::new(&eye).args(&args).output().unwrap();
        assert!(ran.status.success(), "{}", String::from_utf8_lossy(&ran.stdout));
        let eyes = std::fs::read(&out).unwrap();
        let mut block = json!({ "stack": stack, "max_side": max_side });
        if stack > 1 {
            block["gap_ms"] = 250.into();
        }
        if let Some(c) = crop {
            block["crop"] = Value::Array(c.split(',').map(|x| json!(x.parse::<f64>().unwrap())).collect());
        }
        let encoded: Vec<Vec<u8>> = files.iter().map(|f| std::fs::read(f).unwrap()).collect();
        let mine = pigeon_engine::compose_frames(&block, &encoded).unwrap();
        assert_eq!(mine, eyes, "crop {crop:?}, stack {stack}: the engine's JPEG differs from Eye's");
    }
    let _ = std::fs::remove_file(&out);
}

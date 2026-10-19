//! `libpigeon`: the Pigeon engine behind the C interface of INTERFACE.md §2,
//! for hosts that are not the Pigeon app. The header is `include/pigeon.h`.
//!
//! Unsafe code is in `boundary.rs` only, the twelve C functions themselves;
//! the engine's own is in its `llama.rs` and `apple.rs`. Build the library
//! with `cargo build -p pigeon-ffi --profile ffi`: the app's release profile
//! aborts on a panic, and this one unwinds, so the boundary can answer with
//! an error instead (E23).

#![deny(unsafe_code)]

#[allow(unsafe_code)]
mod boundary;
mod glue;

pub use boundary::*;

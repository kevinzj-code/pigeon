//! `pigeon-core` — reads and checks a `.pigeon` file exactly as the format
//! spec says (Version 1, Draft 5), and builds the prompt and reads the answer
//! the way the spec's §8 fixes them. The first piece of the shared engine.
//!
//! It has no Tauri and no model. Everything a host decides is passed in:
//! which bases, projectors and embedding models the machine holds
//! (`check::Machine`), and which seal keys it trusts — one list for Pigeons
//! and a separate one for registries (`check::Trust`, spec §15.2).
//!
//! - `check::check` is the import check (§7.3). A refusal or a warning has a
//!   stable code from the spec's Appendix A and a sentence a person can act on.
//! - `ask` fills the template, builds the chat, and reads the model's text
//!   into the answer the Pigeon promises (§8).
//! - `material` retrieves (§9.4), `skill` draws a recipe (§10), `seal`
//!   verifies who packed a file (§15), `nest` opens several Pigeons in one
//!   file (§14), `registry` opens a sealed base registry (§7.4).
//! - `actions` says which key a picture Pigeon's answer presses (§13.2).
//! - `scan` turns the folders a host names into the lists the check takes,
//!   and `hashes` keeps what is known of their sha256 between launches.
//! - `zip_store` and `gguf` are the two containers; `blob` and `revision` are
//!   what a host needs to hold a large file and to keep an old revision aside.
//!
//! The conformance kit runs against `src/bin/pigeon-kit.rs`, and
//! `tests/conformance.rs` fails `cargo test` when a case fails.

pub mod actions;
pub mod ask;
pub mod blob;
pub mod card;
pub mod check;
pub mod gguf;
pub mod hashes;
#[cfg(feature = "test-support")]
pub mod kit;
pub mod manifest;
pub mod material;
pub mod nest;
pub mod registry;
pub mod revision;
pub mod same;
pub mod scan;
pub mod seal;
pub mod skill;
pub mod values;
pub mod zip_store;

pub use check::{check, BaseMatch, Host, InstalledBase, Machine, Needs, Refused, Report, SelfTest, Trust, Warning};
pub use manifest::{plain_id, Manifest};

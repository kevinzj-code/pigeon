//! `pigeon-kit <case_dir>` — the conformance kit's adapter. Reads the case,
//! performs its `op`, prints one JSON object.
//!
//!     python3 run.py --impl "path/to/pigeon-kit"

fn main() {
    let Some(dir) = std::env::args().nth(1) else {
        eprintln!("usage: pigeon-kit <case_dir>");
        std::process::exit(2);
    };
    println!("{}", pigeon_core::kit::run(std::path::Path::new(&dir)));
}

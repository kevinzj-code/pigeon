//! The app's HTTP client for the web tier, built once.
//!
//! A `reqwest::Client` owns a connection pool and a TLS configuration;
//! building one per request throws both away. Timeouts differ per call, so
//! they live on each request (`RequestBuilder::timeout`), not here.

use std::sync::OnceLock;

/// For the web tier: identifies itself, default redirect policy.
pub fn web() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("Pigeon/0.1 (Airoplane Mode; offline-first assistant)")
            .build()
            .expect("the web HTTP client could not be built")
    })
}

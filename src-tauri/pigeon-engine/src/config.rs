//! The engine's config (INTERFACE.md §5.1), as JSON.

use std::path::PathBuf;

use serde::Deserialize;

#[derive(Deserialize, Debug, Clone)]
pub struct Config {
    #[serde(default)]
    pub base_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub projector_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub embedding_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub registries: Vec<PathBuf>,
    #[serde(default)]
    pub trusted_pigeon_keys: Vec<String>,
    #[serde(default)]
    pub trusted_registry_keys: Vec<String>,
    /// E11: the one file of known hashes. Without it, hashes are kept in
    /// memory only and nothing is written.
    #[serde(default)]
    pub hash_cache: Option<PathBuf>,
    #[serde(default)]
    pub downloads: bool,
    #[serde(default)]
    pub download_dir: Option<PathBuf>,
    #[serde(default = "auto")]
    pub backend: String,
    /// Weights, projectors and contexts together stay under this.
    #[serde(default)]
    pub memory_limit_bytes: Option<u64>,
    #[serde(default = "two")]
    pub max_bases_loaded: usize,
    /// How many contexts run at once on one loaded base.
    #[serde(default = "one")]
    pub parallel: usize,
    /// Cells in each context, shared by the requests running in it.
    #[serde(default = "context_tokens")]
    pub context_tokens: u32,
    /// E17: a base that has answered nothing for this many seconds is
    /// unloaded, and loads again on its next ask. Absent or 0: never.
    #[serde(default)]
    pub idle_unload_s: Option<u64>,
    /// E26: cells each context may keep Pigeons' prompts in, so a Pigeon's
    /// next ask evaluates only what follows the part they share. 0 is off.
    #[serde(default = "prefix_cache_tokens")]
    pub prefix_cache_tokens: u32,
    /// Test only: apply the grammar to the whole vocabulary at every step,
    /// even at temperature 0, instead of checking the greedy pick first.
    /// The two give the same answers; this exists to prove it.
    #[serde(default)]
    #[doc(hidden)]
    pub grammar_first_always: bool,
}

fn auto() -> String {
    "auto".into()
}
fn two() -> usize {
    2
}
fn one() -> usize {
    1
}
fn context_tokens() -> u32 {
    8192
}
/// E26's default: on, 2048 cells per context.
pub const PREFIX_CACHE_DEFAULT: u32 = 2048;
fn prefix_cache_tokens() -> u32 {
    PREFIX_CACHE_DEFAULT
}

impl Config {
    /// E17's period, or None when bases are held until unloaded or shut down.
    pub fn idle_period(&self) -> Option<std::time::Duration> {
        self.idle_unload_s.filter(|s| *s > 0).map(std::time::Duration::from_secs)
    }

    pub fn parse(json: &str) -> Result<Config, String> {
        let c: Config = serde_json::from_str(json).map_err(|e| format!("the config could not be read — {e}"))?;
        if !matches!(c.backend.as_str(), "auto" | "metal" | "cpu" | "cuda" | "vulkan") {
            return Err(format!("backend must be auto, metal, cuda, vulkan or cpu, not {}", c.backend));
        }
        if !matches!(c.backend.as_str(), "auto" | "metal") {
            return Err(format!("this build runs on Metal only; {} is not built in", c.backend));
        }
        // E22: version 1 has no downloader, so an engine asked for one is
        // refused rather than made to look able.
        if c.downloads {
            return Err("this build has no downloader (E22): leave downloads off; pigeon_fetch answers downloads_off".into());
        }
        if c.parallel == 0 || c.max_bases_loaded == 0 || c.context_tokens < 256 {
            return Err("parallel and max_bases_loaded must be at least 1, and context_tokens at least 256".into());
        }
        Ok(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_unload_is_off_unless_given_and_zero_means_never() {
        assert_eq!(Config::parse("{}").unwrap().idle_unload_s, None);
        assert_eq!(Config::parse(r#"{"idle_unload_s":600}"#).unwrap().idle_period(), Some(std::time::Duration::from_secs(600)));
        assert_eq!(Config::parse(r#"{"idle_unload_s":0}"#).unwrap().idle_period(), None);
        assert!(Config::parse(r#"{"idle_unload_s":-1}"#).is_err());
    }

    /// E26: the stamp names the prefix-cache setting, so a score says which.
    #[test]
    fn the_runtime_stamp_names_the_prefix_cache_setting() {
        assert_eq!(crate::version(), "libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 2048)");
        assert_eq!(crate::version_with(0), "libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache off)");
        assert_eq!(crate::version_with(512), "libpigeon 0.1.0 (llama.cpp 26394b4; spec 1; prefix-cache 512)");
        assert_eq!(Config::parse("{}").unwrap().prefix_cache_tokens, PREFIX_CACHE_DEFAULT);
    }

    #[test]
    fn an_engine_with_downloads_on_is_refused_e22() {
        assert!(Config::parse(r#"{"downloads":true}"#).unwrap_err().contains("no downloader"));
        assert!(Config::parse(r#"{"downloads":false}"#).is_ok());
    }
}

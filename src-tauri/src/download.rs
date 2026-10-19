//! The first-run download: resumable, checksummed, cancellable — and nothing
//! the page can point anywhere.
//!
//! `models_download` takes no arguments. What it fetches is the manifest's
//! model from the manifest's URL; the page can start it, cancel it and
//! watch it, and that is all. `models_download_picture` is the same for the
//! manifest's picture model — its base and its projector — asked for from
//! Peek and never on first run. This is Pigeon's third network door after the
//! two search endpoints, and like them the host is fixed in the source.
//!
//! What a download does, in order, per file:
//!   1. the licence texts and ATTRIBUTION.md are written beside the weights
//!      BEFORE the connection is opened (`weights::write_notices`);
//!   2. an existing `<file>.part` is hashed and its length sent as a Range —
//!      a 206 continues it, a 200 means the server ignored the Range and the
//!      part is discarded (Loft's honest-206 rule);
//!   3. the server's total must equal the manifest's byte count, or nothing
//!      is written: a re-uploaded file is refused before a byte of it lands;
//!   4. chunks are appended and hashed as they arrive; a cancel keeps the
//!      part for next time and returns the exact string `cancelled`;
//!   5. a body shorter than promised keeps the part and errors — a short
//!      file is never renamed into place, because a truncated GGUF loads far
//!      enough to crash the engine mid-answer (Loft's short-file guard);
//!   6. the SHA-256 of the whole file must match the manifest; a mismatch
//!      deletes the part (it cannot be resumed into a good file) and errors;
//!   7. only then is the part renamed to its name, and the verified hash
//!      recorded in the app's hash cache (`hashes.rs`), which the status
//!      command reads back. Nothing is written beside the model.
//!
//! Progress goes to the page as `model-download-progress`, throttled to one
//! event per 150 ms plus every stage change.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::hardware;
use crate::manifest::{self, Licence, Notice};
use crate::weights::{self, WeightState};

pub const PROGRESS_EVENT: &str = "model-download-progress";
pub const CANCELLED: &str = "cancelled";
const PROGRESS_EVERY: Duration = Duration::from_millis(150);
const CHUNK_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Stage {
    Download,
    Verify,
    Done,
    Failed,
}

#[derive(Serialize, Clone, Debug)]
pub struct Progress {
    pub id: String,
    pub stage: Stage,
    pub received: u64,
    pub total: u64,
    pub overall_received: u64,
    pub overall_total: u64,
    pub resumed: bool,
    pub error: Option<String>,
}

/// One row of `models_status`: the manifest's description of a model plus
/// where it stands on this machine.
#[derive(Serialize, Clone, Debug)]
pub struct ModelInfo {
    pub id: String,
    pub role: String,
    pub name: String,
    pub quant: String,
    pub file: String,
    pub bytes: u64,
    pub resident_mb: u64,
    pub licence: Licence,
    #[serde(flatten)]
    pub state: WeightState,
    pub adapter: Option<AdapterInfo>,
}

#[derive(Serialize, Clone, Debug)]
pub struct AdapterInfo {
    pub file: String,
    pub present: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct HardwareInfo {
    pub total_mb: u64,
    pub budget_mb: u64,
    pub share_mb: u64,
    pub need_mb: u64,
    pub fit: hardware::Fit,
    pub spare: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct ModelsStatus {
    pub models: Vec<ModelInfo>,
    /// Bytes a download would fetch: every model not present and not borrowed.
    pub download_bytes: u64,
    /// The same, less what a `.part` already holds.
    pub remaining_bytes: u64,
    pub downloading: bool,
    /// None where RAM could not be read.
    pub hardware: Option<HardwareInfo>,
    pub notices: Vec<Notice>,
    /// The picture model, when this build names one.
    pub picture: Option<PictureInfo>,
    /// The embedding model a grounded Pigeon's search needs, when this build
    /// names one: present, or how much a download would fetch.
    pub embedding: Option<EmbeddingInfo>,
}

/// What a Reader's page offers while the search model is missing.
#[derive(Serialize, Clone, Debug)]
pub struct EmbeddingInfo {
    pub name: String,
    pub licence: Licence,
    pub present: bool,
    pub download_bytes: u64,
    pub remaining_bytes: u64,
}

/// What Peek's download would fetch, and under what terms.
#[derive(Serialize, Clone, Debug)]
pub struct PictureInfo {
    pub name: String,
    pub licence: Licence,
    /// Bytes still to fetch across the base and the projector; 0 when both
    /// are here.
    pub download_bytes: u64,
    /// The same, less what `.part` files already hold.
    pub remaining_bytes: u64,
}

/// Managed state: one download at a time, and one flag to stop it.
pub struct Downloads {
    cancel: AtomicBool,
    running: Mutex<bool>,
}

impl Downloads {
    pub fn new() -> Self {
        Downloads { cancel: AtomicBool::new(false), running: Mutex::new(false) }
    }
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }
    fn is_running(&self) -> bool {
        self.running.lock().map(|r| *r).unwrap_or(false)
    }
    /// Claim the one slot; false if a download is already running.
    fn claim(&self) -> bool {
        match self.running.lock() {
            Ok(mut r) if !*r => {
                *r = true;
                self.cancel.store(false, Ordering::SeqCst);
                true
            }
            _ => false,
        }
    }
    fn release(&self) {
        if let Ok(mut r) = self.running.lock() {
            *r = false;
        }
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

/// Hash what a part file already holds, so a resumed download's digest
/// covers the whole file and not just the bytes fetched this time.
fn hash_existing(part: &Path) -> Result<(Sha256, u64), String> {
    use std::io::Read;
    let mut hasher = Sha256::new();
    let mut len = 0u64;
    match std::fs::File::open(part) {
        Ok(mut f) => {
            let mut buf = vec![0u8; 1 << 20];
            loop {
                let n = f.read(&mut buf).map_err(|e| format!("what has downloaded so far could not be read back — {e}"))?;
                if n == 0 {
                    break;
                }
                hasher.update(&buf[..n]);
                len += n as u64;
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(format!("what has downloaded so far could not be opened — {e}")),
    }
    Ok((hasher, len))
}

/// Fetch `url` into `dest`, resuming a `.part`, verifying `expected_bytes`
/// and `sha256`, calling `on_progress(received, resumed)` as bytes land.
/// Pure over its arguments: the tests point it at a local server.
pub async fn fetch_verified(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    expected_bytes: u64,
    sha256: &str,
    cancel: &AtomicBool,
    on_progress: &mut (dyn FnMut(u64, bool) + Send),
) -> Result<(), String> {
    use std::io::Write;
    let part = weights::part_path(dest);
    let (mut hasher, mut already) = hash_existing(&part)?;

    if already < expected_bytes {
        let mut req = client.get(url);
        if already > 0 {
            req = req.header("Range", format!("bytes={already}-"));
        }
        let resp = req.send().await.map_err(|e| {
            plog!("download", "{e}");
            "Couldn’t reach huggingface.co — check you’re online, then try again.".to_string()
        })?;
        let status = resp.status().as_u16();
        let (append, base) = match status {
            206 => (true, already),
            200 => (false, 0),
            416 => {
                // Our part is longer than the file: it is not this file.
                (false, 0)
            }
            s => return Err(format!("the model host answered {s} for {url}")),
        };
        let resumed = append;
        if !append {
            hasher = Sha256::new();
            already = 0;
        }
        if status == 416 {
            let _ = std::fs::remove_file(&part);
            return Err(format!("the partial download did not match the file; it was discarded — try again to start over"));
        }
        let promised = resp.content_length().map(|n| n + base);
        if let Some(total) = promised {
            if total != expected_bytes {
                return Err(format!(
                    "the model host reports {total} bytes for {}, the manifest says {expected_bytes}; nothing was written — the pinned file may have changed",
                    dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
                ));
            }
        }
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(append)
            .write(true)
            .truncate(!append)
            .open(&part)
            /* The path is built here, inside the app's own data directory, so it
               is not the reader's to act on — the reason is. This error reaches
               the person verbatim, on the download card. */
            .map_err(|e| format!("the download could not be written to this Mac — {e}"))?;
        let mut received = already;
        let mut resp = resp;
        on_progress(received, resumed);
        loop {
            if cancel.load(Ordering::SeqCst) {
                let _ = file.flush();
                return Err(CANCELLED.into());
            }
            // A body that ends before its Content-Length surfaces here as a
            // decode error, not as a short count: same verdict, part kept.
            let chunk = match resp.chunk().await {
                Ok(c) => c,
                Err(e) => {
                    let _ = file.flush();
                    return Err(format!(
                        "the download broke off at {received} of {expected_bytes} bytes ({e}); the part is kept — try again to resume"
                    ));
                }
            };
            let Some(chunk) = chunk else { break };
            file.write_all(&chunk).map_err(|e| format!("the download could not be written to this Mac — {e}"))?;
            hasher.update(&chunk);
            received += chunk.len() as u64;
            on_progress(received, resumed);
        }
        file.flush().map_err(|e| e.to_string())?;
        drop(file);
        if received < expected_bytes {
            return Err(format!(
                "the download stopped at {received} of {expected_bytes} bytes; the part is kept — try again to resume"
            ));
        }
        if received > expected_bytes {
            let _ = std::fs::remove_file(&part);
            return Err(format!("the model host sent {received} bytes where the manifest says {expected_bytes}; discarded"));
        }
    }

    let hex = format!("{:x}", hasher.finalize());
    if hex != sha256 {
        let _ = std::fs::remove_file(&part);
        return Err(format!(
            "checksum mismatch: the file hashed to {}… but the manifest says {}…; the download was discarded",
            &hex[..12],
            &sha256[..12]
        ));
    }
    std::fs::rename(&part, dest).map_err(|e| format!("could not move the download into place: {e}"))?;
    // The caller records the verified hash in the app's hash cache.
    Ok(())
}

/* ── the commands ────────────────────────────────────────────────────────── */

fn status_for<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<ModelsStatus, String> {
    let m = manifest::manifest()?;
    let own = weights::own_dir(app)?;
    let mut models = Vec::new();
    let mut download_bytes = 0;
    let mut remaining_bytes = 0;
    let mut need_mb = 0;
    for spec in &m.models {
        let state = weights::state_in(spec, &own, &crate::hashes::of(app));
        match state {
            WeightState::Missing => {
                download_bytes += spec.bytes;
                remaining_bytes += spec.bytes;
            }
            WeightState::Partial { have_bytes } => {
                download_bytes += spec.bytes;
                remaining_bytes += spec.bytes.saturating_sub(have_bytes);
            }
            _ => {}
        }
        need_mb += spec.need_mb();
        models.push(ModelInfo {
            id: spec.id.clone(),
            role: spec.role.clone(),
            name: spec.name.clone(),
            quant: spec.quant.clone(),
            file: spec.file.clone(),
            bytes: spec.bytes,
            resident_mb: spec.resident_mb,
            licence: spec.licence.clone(),
            state,
            adapter: spec.adapter.as_ref().map(|a| AdapterInfo {
                file: a.file.clone(),
                // From Patch v6 the router is a Pigeon in his nest (D84).
                present: crate::patch::pigeon_source(app, "patch-router").is_some(),
            }),
        });
    }
    let hardware = hardware::total_ram_mb().map(|total| {
        let b = hardware::budget_from(total);
        HardwareInfo {
            total_mb: b.total_mb,
            budget_mb: b.budget_mb,
            share_mb: b.share_mb,
            need_mb,
            fit: hardware::plan_fit(need_mb, b.share_mb),
            spare: hardware::has_spare(need_mb, b.share_mb),
        }
    });
    let downloads: State<Downloads> = app.state();
    let picture = m.picture.as_ref().map(|p| {
        let (mut download_bytes, mut remaining_bytes) = (0, 0);
        let hashes = crate::hashes::of(app);
        for (f, dest) in picture_targets(app, p).unwrap_or_default() {
            if picture_file_here(&f, &dest, &hashes) {
                continue;
            }
            let have = std::fs::metadata(weights::part_path(&dest)).map(|m| m.len()).unwrap_or(0);
            download_bytes += f.bytes;
            remaining_bytes += f.bytes.saturating_sub(have);
        }
        PictureInfo { name: p.name.clone(), licence: p.licence.clone(), download_bytes, remaining_bytes }
    });
    let embedding = m.embedding.as_ref().map(|e| {
        let present = embedding_model_here(app, e).is_some();
        let dest = weights::own_dir(app).map(|d| d.join(&e.file)).unwrap_or_default();
        let have = std::fs::metadata(weights::part_path(&dest)).map(|m| m.len()).unwrap_or(0);
        EmbeddingInfo {
            name: e.name.clone(),
            licence: e.licence.clone(),
            present,
            download_bytes: if present { 0 } else { e.bytes },
            remaining_bytes: if present { 0 } else { e.bytes.saturating_sub(have) },
        }
    });
    Ok(ModelsStatus {
        models,
        download_bytes,
        remaining_bytes,
        downloading: downloads.is_running(),
        hardware,
        notices: m.notices(),
        picture,
        embedding,
    })
}

/// The embedding model on this Mac, by file name, in Pigeon's own folder.
/// The hash is checked by the download and, on import, by the file that
/// names it — not on every status read.
pub fn embedding_model_here<R: tauri::Runtime>(app: &AppHandle<R>, e: &manifest::EmbeddingSpec) -> Option<std::path::PathBuf> {
    weights::own_dir(app).ok().map(|d| d.join(&e.file)).filter(|p| p.is_file())
}

/// Fetch the embedding model a grounded Pigeon's search needs, the same way
/// and under the same rules as the picture model. A Reader's page asks for
/// it; nothing else does.
#[tauri::command]
pub async fn models_download_embedding<R: tauri::Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let downloads: State<Downloads> = app.state();
    if !downloads.claim() {
        return Err("a download is already running".into());
    }
    let result = async {
        let m = manifest::manifest()?;
        let e = m.embedding.as_ref().ok_or("this build names no embedding model")?;
        let own = weights::own_dir(&app)?;
        weights::write_notices(&own, m)?;
        if embedding_model_here(&app, e).is_some() {
            return Ok(());
        }
        fetch_all(&app, &downloads, vec![("embedding".to_string(), e.url.clone(), own.join(&e.file), e.bytes, e.sha256.clone())]).await
    }
    .await;
    downloads.release();
    let _ = app.emit(crate::engine::EVENT, app.state::<crate::engine::Engine>().snapshot(&app));
    result
}

/// Where the picture model's two files land: the base beside the other
/// models, the projector in `projectors/`, where a picture Pigeon's carried
/// one is kept and where `projector_in` looks.
fn picture_targets<R: tauri::Runtime>(app: &AppHandle<R>, p: &manifest::PictureSpec) -> Result<Vec<(manifest::FileSpec, std::path::PathBuf)>, String> {
    let own = weights::own_dir(app)?;
    let [base, projector] = p.files();
    let dest = own.join(&base.file);
    let proj = own.join("projectors").join(&projector.file);
    Ok(vec![(base, dest), (projector, proj)])
}

/// Already on this Mac: the base by name, the projector
/// by hash — a picture Pigeon may have brought the same one under its own name.
fn picture_file_here(f: &manifest::FileSpec, dest: &Path, hashes: &crate::hashes::Hashes) -> bool {
    if dest.parent().and_then(|d| d.file_name()).is_some_and(|n| n == "projectors") {
        return dest.parent().and_then(|d| crate::pigeon::projector_in(d, &f.sha256, hashes)).is_some();
    }
    dest.is_file()
}

#[tauri::command]
pub async fn models_status<R: tauri::Runtime>(app: AppHandle<R>) -> Result<ModelsStatus, String> {
    status_for(&app)
}

#[tauri::command]
pub async fn models_cancel<R: tauri::Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let downloads: State<Downloads> = app.state();
    downloads.cancel();
    Ok(())
}

/// Fetch every model that is missing or partial, in manifest order. Returns
/// only when all of them are present and verified; `Err("cancelled")` is the
/// page's cancel contract.
#[tauri::command]
pub async fn models_download<R: tauri::Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let downloads: State<Downloads> = app.state();
    if !downloads.claim() {
        return Err("a download is already running".into());
    }
    let result = download_all(&app, &downloads).await;
    downloads.release();
    result
}

/// Fetch the picture model's base and projector, whichever are missing, the
/// same way and under the same rules as the first-run download. Peek asks for
/// it; nothing else does.
#[tauri::command]
pub async fn models_download_picture<R: tauri::Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let downloads: State<Downloads> = app.state();
    if !downloads.claim() {
        return Err("a download is already running".into());
    }
    let result = download_picture(&app, &downloads).await;
    downloads.release();
    /* Peek reads whether its model is here off the engine's status. */
    let _ = app.emit(crate::engine::EVENT, app.state::<crate::engine::Engine>().snapshot(&app));
    result
}

/// A stock projector a picture Pigeon names and leaves out (format §13.1),
/// from the registry this app ships with: the registry's own address, size and
/// hash, into the projector store, verified before it is kept. The page shows
/// the licence before it asks for this (§16.4).
#[tauri::command]
pub async fn models_download_projector<R: tauri::Runtime>(app: AppHandle<R>, sha: String) -> Result<(), String> {
    let downloads: State<Downloads> = app.state();
    if !downloads.claim() {
        return Err("a download is already running".into());
    }
    let result = download_projector(&app, &downloads, sha.trim()).await;
    downloads.release();
    result
}

async fn download_projector<R: tauri::Runtime>(app: &AppHandle<R>, downloads: &Downloads, sha: &str) -> Result<(), String> {
    let (base, file) = crate::pigeon::registries()
        .iter()
        .find_map(|r| r.stock_projector(sha))
        .ok_or("no registry this app trusts lists that projector")?;
    let store = weights::own_dir(app)?.join("projectors");
    std::fs::create_dir_all(&store).map_err(|e| format!("could not make a place for the projector — {e}"))?;
    if crate::pigeon::projector_in(&store, sha, &crate::hashes::of(app)).is_some() {
        return Ok(());
    }
    let (url, bytes) = (file.url.clone().ok_or("the registry gives no address for that projector")?, file.bytes.ok_or("the registry gives no size for that projector")?);
    let dest = projector_dest(&store, &file.file, sha);
    // Its licence beside it, before a byte is fetched.
    weights::write_projector_notice(&dest, base, file)?;
    fetch_all(app, downloads, vec![("projector".to_string(), url, dest, bytes, sha.to_string())]).await
}

/// Where a downloaded projector goes: the registry's name for it, when that is
/// one plain `.gguf` file name and free; otherwise one with its hash in it, so
/// a different projector already under that name is kept.
fn projector_dest(store: &Path, name: &str, sha: &str) -> std::path::PathBuf {
    let short = &sha[..12.min(sha.len())];
    let plain = Path::new(name).file_name().and_then(|n| n.to_str()).filter(|n| *n == name && n.ends_with(".gguf") && !n.starts_with('.'));
    let dest = store.join(plain.map(String::from).unwrap_or_else(|| format!("{short}.gguf")));
    // A `.part` of this very download is resumed, not set aside.
    if dest.exists() {
        return store.join(format!("{}-{short}.gguf", dest.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()));
    }
    dest
}

async fn download_picture<R: tauri::Runtime>(app: &AppHandle<R>, downloads: &Downloads) -> Result<(), String> {
    let m = manifest::manifest()?;
    let p = m.picture.as_ref().ok_or("this build names no picture model")?;
    weights::write_notices(&weights::own_dir(app)?, m)?;
    let ids = ["picture", "picture-projector"];
    let hashes = crate::hashes::of(app);
    let todo: Vec<_> = picture_targets(app, p)?
        .into_iter()
        .zip(ids)
        .filter(|((f, dest), _)| !picture_file_here(f, dest, &hashes))
        .map(|((f, dest), id)| (id.to_string(), f.url, dest, f.bytes, f.sha256))
        .collect();
    std::fs::create_dir_all(weights::own_dir(app)?.join("projectors")).map_err(|e| format!("could not make a place for the projector — {e}"))?;
    fetch_all(app, downloads, todo).await
}

async fn download_all<R: tauri::Runtime>(app: &AppHandle<R>, downloads: &Downloads) -> Result<(), String> {
    let m = manifest::manifest()?;
    let own = weights::own_dir(app)?;
    weights::write_notices(&own, m)?;
    let hashes = crate::hashes::of(app);
    let todo = m
        .models
        .iter()
        .filter(|s| {
            matches!(
                weights::state_in(s, &own, &hashes),
                WeightState::Missing | WeightState::Partial { .. }
            )
        })
        .map(|s| (s.id.clone(), s.url.clone(), own.join(&s.file), s.bytes, s.sha256.clone()))
        .collect();
    fetch_all(app, downloads, todo).await
}

/// Fetch each `(id, url, dest, bytes, sha256)` in order, one progress stream
/// over all of them.
async fn fetch_all<R: tauri::Runtime>(
    app: &AppHandle<R>,
    downloads: &Downloads,
    todo: Vec<(String, String, std::path::PathBuf, u64, String)>,
) -> Result<(), String> {
    let overall_total: u64 = todo.iter().map(|t| t.3).sum();
    let mut done_bytes = 0u64;
    // No whole-request timeout — 2.3 GB on a slow link is minutes — but a
    // host that stops sending mid-body is given a minute, then reported.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(CHUNK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    for (id, url, dest, bytes, sha256) in todo {
        let total = bytes;
        let emit = |stage: Stage, received: u64, resumed: bool, error: Option<String>| {
            let _ = app.emit(
                PROGRESS_EVENT,
                Progress {
                    id: id.clone(),
                    stage,
                    received,
                    total,
                    overall_received: done_bytes + received,
                    overall_total,
                    resumed,
                    error,
                },
            );
        };
        let mut last = Instant::now() - PROGRESS_EVERY;
        let mut last_received = 0u64;
        let mut last_resumed = false;
        let mut on_progress = |received: u64, resumed: bool| {
            last_received = received;
            last_resumed = resumed;
            if last.elapsed() >= PROGRESS_EVERY {
                last = Instant::now();
                emit(Stage::Download, received, resumed, None);
            }
        };
        let file = dest.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let started = Instant::now();
        crate::log::write("download", &format!("start {id}: {file}, {} MB, from {url}", total / (1024 * 1024)));
        let fetched = fetch_verified(&client, &url, &dest, bytes, &sha256, &downloads.cancel, &mut on_progress);
        // `verify` is announced when the body is complete, before the hash
        // is compared; the closure above cannot know that, so it is emitted
        // from the outcome instead.
        match fetched.await {
            Ok(()) => {
                crate::log::write(
                    "download",
                    &format!("done {id}: {file}, hash matched sha256 {}…, {} s{}", &sha256[..12.min(sha256.len())], started.elapsed().as_secs(), if last_resumed { ", resumed" } else { "" }),
                );
                crate::hashes::of(app).record(&dest, &sha256);
                emit(Stage::Verify, total, last_resumed, None);
                emit(Stage::Done, total, last_resumed, None);
                done_bytes += total;
            }
            Err(e) => {
                crate::log::write("download", &format!("failed {id}: {file} after {} MB: {e}", last_received / (1024 * 1024)));
                emit(Stage::Failed, last_received, last_resumed, Some(e.clone()));
                return Err(e);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::Arc;

    /// A one-file HTTP server. `honour_range` answers a Range with 206 and the
    /// tail; otherwise it answers 200 with the whole body. `cut_at` closes the
    /// connection after that many body bytes while still promising the full
    /// length. Records the last Range header it saw.
    struct FakeHost {
        port: u16,
        last_range: Arc<Mutex<Option<String>>>,
    }

    fn host(body: Vec<u8>, honour_range: bool, cut_at: Option<usize>, slow: bool) -> FakeHost {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        let last_range = Arc::new(Mutex::new(None));
        let seen = last_range.clone();
        std::thread::spawn(move || {
            for stream in l.incoming().take(8) {
                let Ok(mut s) = stream else { break };
                let mut buf = vec![0u8; 4096];
                let n = s.read(&mut buf).unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_string();
                // hyper sends header names in lower case
                let range = req
                    .lines()
                    .find_map(|l| l.to_ascii_lowercase().strip_prefix("range: bytes=").map(String::from))
                    .map(|r| r.trim().trim_end_matches('-').to_string());
                *seen.lock().unwrap() = range.clone();
                let start: usize = match (&range, honour_range) {
                    (Some(r), true) => r.parse().unwrap_or(0),
                    _ => 0,
                };
                let tail = &body[start.min(body.len())..];
                let status = if start > 0 && honour_range { "206 Partial Content" } else { "200 OK" };
                let _ = write!(
                    s,
                    "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    tail.len()
                );
                let send = match cut_at {
                    Some(c) => &tail[..c.min(tail.len())],
                    None => tail,
                };
                if slow {
                    for piece in send.chunks(4096) {
                        if s.write_all(piece).is_err() {
                            break;
                        }
                        std::thread::sleep(Duration::from_millis(5));
                    }
                } else {
                    let _ = s.write_all(send);
                }
                let _ = s.flush();
            }
        });
        FakeHost { port, last_range }
    }

    fn body(seed: u8, len: usize) -> Vec<u8> {
        (0..len).map(|i| (i as u32).wrapping_mul(2654435761).wrapping_add(seed as u32) as u8).collect()
    }

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pigeon-download-test-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.join("model.gguf")
    }

    async fn fetch(h: &FakeHost, dest: &Path, len: u64, sha: &str, cancel: &AtomicBool, seen: &mut Vec<(u64, bool)>) -> Result<(), String> {
        let client = reqwest::Client::new();
        let mut on = |r: u64, resumed: bool| seen.push((r, resumed));
        fetch_verified(&client, &format!("http://127.0.0.1:{}/model.gguf", h.port), dest, len, sha, cancel, &mut on).await
    }

    #[test]
    fn sha256_of_a_known_vector() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }

    #[tokio::test]
    async fn a_full_download_verifies_and_leaves_no_marker() {
        let data = body(1, 300_000);
        let sha = sha256_hex(&data);
        let h = host(data.clone(), true, None, false);
        let dest = scratch("full");
        let mut seen = Vec::new();
        fetch(&h, &dest, data.len() as u64, &sha, &AtomicBool::new(false), &mut seen).await.unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), data);
        let mut marker = dest.as_os_str().to_owned();
        marker.push(".sha256");
        assert!(!std::path::PathBuf::from(marker).exists(), "the hash goes to the app's cache, not beside the model");
        assert!(!weights::part_path(&dest).exists());
        assert_eq!(seen.last().unwrap().0, data.len() as u64);
        assert!(!seen[0].1, "a fresh download is not resumed");
    }

    #[tokio::test]
    async fn a_resume_continues_from_the_part_and_still_hashes_the_whole_file() {
        let data = body(2, 400_000);
        let sha = sha256_hex(&data);
        let h = host(data.clone(), true, None, false);
        let dest = scratch("resume");
        std::fs::write(weights::part_path(&dest), &data[..150_000]).unwrap();
        let mut seen = Vec::new();
        fetch(&h, &dest, data.len() as u64, &sha, &AtomicBool::new(false), &mut seen).await.unwrap();
        assert_eq!(h.last_range.lock().unwrap().as_deref(), Some("150000"));
        assert!(seen[0].1, "the page is told it resumed");
        assert_eq!(seen[0].0, 150_000);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
    }

    #[tokio::test]
    async fn a_server_that_ignores_range_restarts_from_zero() {
        let data = body(3, 200_000);
        let sha = sha256_hex(&data);
        let h = host(data.clone(), false, None, false);
        let dest = scratch("ignored-range");
        std::fs::write(weights::part_path(&dest), b"garbage that is not the file").unwrap();
        let mut seen = Vec::new();
        fetch(&h, &dest, data.len() as u64, &sha, &AtomicBool::new(false), &mut seen).await.unwrap();
        assert!(!seen[0].1, "a 200 is not a resume");
        assert_eq!(std::fs::read(&dest).unwrap(), data, "the garbage was discarded, not prepended");
    }

    #[tokio::test]
    async fn a_short_body_keeps_the_part_and_errors() {
        let data = body(4, 200_000);
        let sha = sha256_hex(&data);
        let h = host(data.clone(), true, Some(120_000), false);
        let dest = scratch("short");
        let mut seen = Vec::new();
        let err = fetch(&h, &dest, data.len() as u64, &sha, &AtomicBool::new(false), &mut seen).await.unwrap_err();
        assert!(err.contains("resume"), "{err}");
        assert!(!dest.exists(), "a short file was renamed into place");
        assert_eq!(std::fs::metadata(weights::part_path(&dest)).unwrap().len(), 120_000);
    }

    #[tokio::test]
    async fn a_bad_checksum_removes_the_part() {
        let data = body(5, 100_000);
        let wrong = sha256_hex(b"something else");
        let h = host(data.clone(), true, None, false);
        let dest = scratch("badsum");
        let mut seen = Vec::new();
        let err = fetch(&h, &dest, data.len() as u64, &wrong, &AtomicBool::new(false), &mut seen).await.unwrap_err();
        assert!(err.contains("checksum"), "{err}");
        assert!(!dest.exists());
        assert!(!weights::part_path(&dest).exists(), "a corrupt part must not be resumed into a good file");
    }

    #[tokio::test]
    async fn a_wrong_content_length_is_refused_before_writing() {
        let data = body(6, 50_000);
        let sha = sha256_hex(&data);
        let h = host(data.clone(), true, None, false);
        let dest = scratch("length");
        let mut seen = Vec::new();
        let err = fetch(&h, &dest, 60_000, &sha, &AtomicBool::new(false), &mut seen).await.unwrap_err();
        assert!(err.contains("manifest says"), "{err}");
        assert!(!weights::part_path(&dest).exists(), "nothing should have been written");
    }

    /// The real host, a few megabytes of it: Hugging Face's resolve URL
    /// redirects to a CDN, the CDN honours a Range with a 206, and a cancel
    /// keeps the part so the next attempt resumes. Ignored because it needs
    /// the network; run with `cargo test -- --ignored a_real_host`. Nothing
    /// is downloaded in full and nothing lands outside a temp dir.
    #[tokio::test]
    #[ignore]
    async fn a_real_host_answers_a_range_and_a_cancel_resumes() {
        let spec = manifest::manifest().unwrap().for_role(crate::Role::Category).unwrap().clone();
        let dest = scratch("real-host");
        let client = reqwest::Client::builder().connect_timeout(Duration::from_secs(20)).build().unwrap();
        // First attempt: cancel once a few chunks have landed.
        let cancel = Arc::new(AtomicBool::new(false));
        let c2 = cancel.clone();
        let mut first = Vec::new();
        let mut on = move |r: u64, resumed: bool| {
            first.push((r, resumed));
            if r > 3_000_000 {
                c2.store(true, Ordering::SeqCst);
            }
        };
        let err = fetch_verified(&client, &spec.url, &dest, spec.bytes, &spec.sha256, &cancel, &mut on).await.unwrap_err();
        assert_eq!(err, CANCELLED, "{err}");
        let kept = std::fs::metadata(weights::part_path(&dest)).unwrap().len();
        assert!(kept > 3_000_000, "kept only {kept}");
        // Second attempt: the host must answer 206 (the callback says resumed)
        // and start where the part ends; cancel again straight away.
        let cancel = Arc::new(AtomicBool::new(false));
        let c2 = cancel.clone();
        let mut seen = Vec::new();
        let mut on = move |r: u64, resumed: bool| {
            seen.push((r, resumed));
            c2.store(true, Ordering::SeqCst);
        };
        let err = fetch_verified(&client, &spec.url, &dest, spec.bytes, &spec.sha256, &cancel, &mut on).await.unwrap_err();
        assert_eq!(err, CANCELLED);
        let after = std::fs::metadata(weights::part_path(&dest)).unwrap().len();
        assert!(after >= kept, "the part shrank: {kept} → {after}");
        let _ = std::fs::remove_dir_all(dest.parent().unwrap());
    }

    #[tokio::test]
    async fn cancel_keeps_the_part_and_says_cancelled() {
        let data = body(7, 600_000);
        let sha = sha256_hex(&data);
        let h = host(data.clone(), true, None, true);
        let dest = scratch("cancel");
        let cancel = Arc::new(AtomicBool::new(false));
        let client = reqwest::Client::new();
        let c2 = cancel.clone();
        let mut calls = 0;
        let mut on = move |_r: u64, _resumed: bool| {
            calls += 1;
            if calls == 3 {
                c2.store(true, Ordering::SeqCst);
            }
        };
        let err = fetch_verified(&client, &format!("http://127.0.0.1:{}/m", h.port), &dest, data.len() as u64, &sha, &cancel, &mut on)
            .await
            .unwrap_err();
        assert_eq!(err, CANCELLED);
        let kept = std::fs::metadata(weights::part_path(&dest)).unwrap().len();
        assert!(kept > 0 && kept < data.len() as u64, "kept {kept} of {}", data.len());
        assert!(!dest.exists());
        // and the next attempt resumes from it and completes
        let h2 = host(data.clone(), true, None, false);
        let mut seen = Vec::new();
        fetch(&h2, &dest, data.len() as u64, &sha, &AtomicBool::new(false), &mut seen).await.unwrap();
        assert!(seen[0].1);
        assert_eq!(std::fs::read(&dest).unwrap(), data);
    }

    /// The picture download against the real host, paused after a moment:
    /// the status counts both files, the pause keeps a part, and the status
    /// then says less remains. Fetches a few MB, never the whole model.
    ///   cargo test --lib -- --ignored picture_download_
    #[tokio::test]
    #[ignore]
    async fn picture_download_pauses_and_counts_what_remains() {
        let mut ctx = tauri::test::mock_context(tauri::test::noop_assets());
        ctx.config_mut().identifier = "mode.airoplane.pigeon.test-picture-download".into();
        let app = tauri::test::mock_builder()
            .manage(Downloads::new())
            .manage(crate::engine::Engine::new())
            .build(ctx)
            .expect("mock app");
        let handle = app.handle().clone();
        let root = handle.path().app_data_dir().unwrap();
        assert!(root.ends_with("mode.airoplane.pigeon.test-picture-download"));
        let _ = std::fs::remove_dir_all(&root);
        let p = manifest::manifest().unwrap().picture.clone().unwrap();

        let before = status_for(&handle).unwrap().picture.unwrap();
        assert_eq!(before.download_bytes, p.bytes + p.projector.bytes);
        let h = handle.clone();
        let run = tokio::spawn(async move { models_download_picture(h).await });
        tokio::time::sleep(Duration::from_secs(4)).await;
        handle.state::<Downloads>().cancel();
        assert_eq!(run.await.unwrap().unwrap_err(), CANCELLED);
        let after = status_for(&handle).unwrap().picture.unwrap();
        eprintln!("remaining {} of {}", after.remaining_bytes, after.download_bytes);
        assert!(after.remaining_bytes < before.remaining_bytes, "nothing was kept");
        let own = weights::own_dir(&handle).unwrap();
        assert!(weights::part_path(&own.join(&p.file)).is_file());
        assert!(own.join("LICENSE-Qwen.txt").is_file(), "the licence is written before the download");
        let _ = std::fs::remove_dir_all(&root);
    }

}

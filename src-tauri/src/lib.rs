//! Pigeon's Tauri shell.
//!
//! INVARIANT: the webview owns nothing but pixels. It has no filesystem, no
//! shell, no dialog and no general network. `capabilities/default.json` grants
//! `core:default` and nothing else, and the CSP's `connect-src` does not admit
//! any host. `tauri-plugin-dialog` is registered for `pigeon.rs`'s own use —
//! its commands are never added to `invoke_handler` below, so the webview
//! still cannot open a picker itself; it can only ask Rust to import a
//! Pigeon, exactly as it asks for anything else. `tauri-plugin-global-shortcut`
//! is held the same way: ⌘⇧P is registered in `setup` below and handled in
//! `bar.rs`, and no window is granted any of its permissions.
//!
//! SIXTY-SEVEN commands exist, and one rule holds across all of them: **the
//! page says what, never where.**
//!
//!   `llm_complete` / `llm_status`  the page names a PIGEON of Patch's
//!       nest; the engine asks it from the file in this app, never an address.
//!   `web_search`                   the page hands over a QUERY; both hosts are
//!       compile-time constants and the query is percent-encoded into them.
//!   `load_state` / `save_state` / `keep_unreadable_state`
//!       the page hands over a JSON STRING, or nothing at all; the path is
//!       built from the app's own data directory (see `store.rs`). The third
//!       moves a file this build cannot parse aside, under a name chosen here,
//!       so an unreadable history is kept rather than overwritten.
//!   `ocr_image` / `ocr_status`     the page hands over image BYTES; the engine
//!       is a binary found here (`PIGEON_TESSERACT`, then PATH, then three
//!       well-known directories) and the bytes go to it on stdin. The image
//!       never lands on disk and the page never learns where the engine is.
//!   `engine_status` / `engine_wake` / `engine_warm` / `engine_sleep` / `engine_set_idle_unload`
//!       the page says WAKE or SLEEP and nothing else; which binary runs,
//!       which weights it loads and on which port are decided in `engine.rs`
//!       from the manifest, the environment and this machine's memory. The
//!       fourth says how long a model may sit unused before it is put down,
//!       and only the three periods Settings offers are accepted — so a page
//!       cannot ask for weights to be held all day.
//!   `models_status` / `models_download` / `models_download_picture` / `models_download_embedding` / `models_download_projector` / `models_cancel`
//!       the page says DOWNLOAD or CANCEL; the two files, their URLs and their
//!       hashes are compiled in from `models.json`, and they land in the app's
//!       own data directory only after their SHA-256 matches (`download.rs`).
//!   `models_on_this_mac` / `models_remove`
//!       every model this Mac keeps lives in Pigeon's store — Flight School
//!       borrows them — and the first lists it, with who relies on each. The
//!       second names an ENTRY from that list, never a place: a name the
//!       listing did not produce is refused before any path is built from it.
//!       One another app relies on is not removed until the page confirms,
//!       and what goes, goes to the Trash (`modelstore.rs`).
//!   `screen_capture` / `screen_capture_status`
//!       the page says CAPTURE; which display, how it is encoded and whether
//!       macOS has been asked for permission are decided in `capture.rs`. The
//!       picture is made in memory and never touches disk (`§5.8`).
//!   `open_main_window` / `set_dev_menu`
//!       the two that move the app's own chrome. `open_main_window` is the
//!       menu bar's way back to the window: it names no window and no
//!       geometry, and `tray.rs` decides what showing it means. `set_dev_menu`
//!       says ON or OFF and the menu bar is rebuilt here with or without the
//!       Developer menu; what is in that menu is decided in `appmenu.rs`.
//!   `popover_hide` / `popover_show`
//!       the menu bar window's two, and both take nothing: Escape, and
//!       stepping out of its own screenshot and back. `core:default` grants a
//!       page no window verbs, so until these existed both failed in silence.
//!   `save_chat` / `remove_chat` / `settings_peek`
//!       the chat store's other three: a chat by the id the page gave it and
//!       its JSON; a deleted chat's id; and the two settings the menu-bar
//!       windows draw with, read from the index alone. No path anywhere.
//!   `window_theme`
//!       Settings → Appearance: dark, light or system, and nothing else. The
//!       main window's own appearance is set to match, so AppKit draws its
//!       title bar in the page's colours (`appearance.rs`). Returns nothing.
//!   `main_hide` / `app_restart`
//!       the main window's two, both taking nothing: what ⌘W does — to the
//!       menu bar — asked for by the page's own "Got it" on the first-close
//!       tip; and a restart, from "Restart now" once a Patch update is in.
//!   `bar_hide` / `bar_show` / `bar_fit` / `bar_bubbles`
//!       the summon bar's four. The first two take nothing; `bar_fit` takes a
//!       HEIGHT in points, which `bar.rs` clamps; `bar_bubbles` takes OPEN or
//!       SHUT, and where the glass bubbles go is decided there. `core:default` gives a page
//!       no way to hide, move or size a window, and these do not change that:
//!       where the bar is, how wide, and how tall it may get are decided there.
//!   `log_event`
//!       the page's one way into the log file (`log.rs`): a KIND word and
//!       its fields as JSON. Rust cuts every text to 80 characters (the plan
//!       alone is kept whole), drops pictures and anything under
//!       `~/.airoplane-mode`, and writes it; the file's place is Rust's.
//!   `diagnostics_log`
//!       takes nothing; returns the header (app, Patch, engine stamp, macOS,
//!       models, memory) and the log's last 60 minutes, for Copy
//!       diagnostics to put on the clipboard. Nothing is sent anywhere.
//!   `logs_save` / `logs_reveal`
//!       Settings › Developer. `logs_save` takes a RANGE word (today, 7, 30
//!       or custom) and, for custom, two DATES; Rust joins those days' log
//!       files under the header and writes one file where the person picks
//!       in a native save dialog, returning its name alone. `logs_reveal`
//!       takes nothing and opens the log folder in Finder.
//!   `diagnostics_copy`
//!       takes the TEXT Copy diagnostics built and puts it on the Mac's
//!       pasteboard (WebKit refuses a page's own write once the click has
//!       waited on `diagnostics_log`). Capped at 8 MB; sends nothing.
//!   `task_complete` / `tasks_list`
//!       a model trained for ONE job, doing that job. The page names a task
//!       from a closed set and supplies only text; the instruction is a
//!       constant in task.rs, so unlike the chat lane this cannot be asked for
//!       arbitrary prose. What comes back is input the page audits, not a reply.
//!
//!   `chat_complete` / `personas_list`
//!       the chat lane, and the ONE command in this shell through which a model
//!       may write words a person reads. The page names a PERSONA and Rust maps
//!       it to a positional adapter; the request goes to the chat endpoint,
//!       never the router's, so nothing the chat lane sends can change what the
//!       router is asked (`chat.rs`).
//!   `pigeon_run`
//!       the FOURTH door, and `task_complete`'s shape with the constant
//!       swapped for a contract: the page names an imported PIGEON and supplies
//!       only text. The prompt it was trained with and the token budget its own
//!       test measured come from the file it was imported from, so this cannot
//!       become another way to ask a model for arbitrary prose (`pigeon.rs`).
//!       A picture Pigeon may also be handed one picture, as a data URL
//!       checked to be one; it goes to the picture server, which this command
//!       starts itself.
//!   `play_permission` / `play_ask` / `play_open_settings` / `play_windows` /
//!   `play_preview` / `play_key_test` / `play_start` / `play_stop` / `play_status`
//!       a picture Pigeon plays a window (`play.rs`): the page names an
//!       installed PIGEON and a window id the watcher listed, never a path or a
//!       key. What is pressed comes only from that Pigeon's own actions.json —
//!       never with a modifier, never while another app is in front — and
//!       ⌘⇧. stops it from anywhere. The permissions are asked in Pigeon's own
//!       process, only when the person presses the button.
//!   `play_hud`
//!       show or hide the play overlay (`playhud.rs`) — a yes or a no, never a
//!       window, a size or a place; the overlay itself comes up when a play
//!       starts, from Rust.
//!   `pigeon_check_ride` / `pigeon_use_new_revision`
//!       a re-imported Pigeon is asked the examples its own file carries; if
//!       it misses any, the version it replaced goes back in, and the second
//!       command is the person choosing the new one anyway. Both name an
//!       installed PIGEON and nothing else; what either retires goes to the
//!       Trash (`pigeon/revision.rs`).
//!
//!   `pigeon_contents` / `pigeon_example_drawings` / `pigeon_save_drawing`
//!       what an installed Pigeon holds, in the three shapes a page has a use
//!       for, and in every one of them the page names a PIGEON and gets back
//!       data. `pigeon_contents` reads a grounded Pigeon's section titles from
//!       its own material, with no model involved, so "that isn't in here" can
//!       name what is. `pigeon_example_drawings` draws its maker's examples
//!       from the Pigeon's own parts table, in memory, so a profile shows
//!       pictures rather than recipes. `pigeon_save_drawing` takes back the
//!       RECIPE the page was answered with — never the SVG, never a path —
//!       draws it again here and writes that, so what lands on disk is only
//!       ever markup this app drew, wherever the page's copy had been.
//!
//!   `pigeon_inspect_pick` / `pigeon_add` / `pigeon_take_opens`
//!       the page says IMPORT and nothing else. A native file picker — invoked
//!       only from Rust — is what names a path; validation and installation
//!       happen here and the page gets back a name, a kind and a status, never
//!       a path (`pigeon.rs`). The pair the window uses splits that in two, so
//!       a file can be DESCRIBED before it is on the Mac: `pigeon_inspect_pick`
//!       picks and reports, installing nothing, and `pigeon_add` installs only
//!       the ids the person ticked — ids this shell handed out, which expire,
//!       and which name bytes already held here rather than anywhere on disk.
//!       `pigeon_take_opens` drains whatever a Finder double-click queued
//!       before the window existed.
//!       A skill pack imported this way is not installed as a Pigeon: it is
//!       checked as Patch and stored as an upgrade for the next launch.
//!
//!   `pigeon_remove`
//!       the inverse of `pigeon_add`: the page names an installed
//!       PERSONA by id and its files come off this Mac. A running server
//!       does not learn of this until it is next asked to restart, same as
//!       a fresh import does not load until then (`pigeon.rs`).
//!
//!   `patch_status`
//!       the page asks WHO PATCH IS and gets data back: a name, a version,
//!       the key that sealed him, his prompts, tunables and categories, and
//!       the base his code is served from. Never a path (`patch.rs`).
//!
//! Not one of them accepts a URL, a host or a path. A page that wanted to reach
//! somewhere else would need a different command and a code change, which is the
//! point. Note that commands registered here are NOT gated by
//! `capabilities/default.json` — that file governs plugin permissions. The
//! boundary is what `invoke_handler` registers and what each command will
//! accept, which is why both are kept narrow and why this comment exists.
//!
//! Patch himself comes from a SEALED PACK, not from files scattered through
//! the bundle. At launch, before the engine can load anything, `patch.rs`
//! checks the pack this build ships and any newer one the person imported —
//! the seal must verify against a key compiled into this binary, the category
//! base must be the one `models.json` pins, the adapter must hash to the
//! pack's own figure, and the pack's copy of every host-API module must be
//! byte-identical to what this build was made against — and picks one: the
//! higher version, the bundled pack on a tie, the bundled pack with a note
//! when an import is refused. The category adapter is extracted from it into
//! Pigeon's own data directory, never into `adapters/` where every file is a
//! persona, and re-hashed at every launch; the engine loads that file and
//! adopts an outside server only if it is wearing exactly that file. The page
//! learns about Patch through `patch_status`, which returns data and never a
//! path.
//!
//! His CODE reaches the page through one read-only custom URI scheme,
//! `pigeon-pack`, and nothing else. It is not a command: it answers GET only,
//! only to the `main`, `popover` and `bar` windows, and only for
//! `pigeon-pack://localhost/v<version>-<sha8>/code/<file>.js` under the active
//! pack's own prefix. The bytes come from the `code/**/*.js` entries held in
//! memory since selection — never a prompt, the seal, the adapter or anything
//! on disk, and a traversal, an encoded separator or a stale prefix is a 404
//! (`patch::serve`). Its consumer is the skills worker, a blob module worker
//! the page creates, which inherits the page CSP: `script-src 'self'
//! pigeon-pack:`, `worker-src blob:`, and a `connect-src` that names no outside
//! host. Under that policy the worker can import Patch's modules but cannot
//! eval, cannot build a function from a string, cannot import from http: or
//! data:, and cannot fetch any other origin — measured in an embedded
//! WKWebView build, not assumed. `Access-Control-Allow-Origin` is sent only to
//! `tauri://localhost` (and, in a debug build, the dev server's origin).
//!
//! Everything else still runs in the webview: the registry, the router, the
//! executor and every skill are pure computation over values the user typed.
//! No skill can reach this command; only the planner seam does.

use serde::{Deserialize, Serialize};
use tauri::Manager;

#[macro_use]
mod log;
mod appmenu;
mod bar;
mod capture;
mod task;
mod chat;
mod download;
mod engine;
mod appearance;
mod geometry;
#[cfg(test)]
use pigeon_core::gguf;
mod hardware;
mod hashes;
mod inprocess;
mod http;
mod manifest;
mod modelstore;
mod patch;
mod pigeon;
mod play;
mod playhud;
mod store;
mod tray;
mod weights;
use pigeon_core::zip_store;

/// Which local model a status row is for. From Patch v10 every Pigeon in his
/// nest runs on one base, Qwen3-VL 2B, so a wake readies one model: the
/// planner role and its Qwen3.5 2B left the app (2026-10-14). The page never
/// names an address, only a Pigeon.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub(crate) enum Role {
    /// The base every text Pigeon runs on: Patch's router, planner and checks,
    /// the tidiers, Pen, and the person's voices.
    Category,
    /// Pictures: Peek and the picture Pigeons. Its status row is the page's.
    Vision,
}

impl Role {
    /// The role a wake readies and the rail shows: one model.
    pub(crate) const ALL: [Role; 1] = [Role::Category];
    /// Every role there is a status for.
    pub(crate) const EVERY: [Role; 2] = [Role::Category, Role::Vision];

    /// The name the page and the manifest use.
    pub(crate) fn as_str(&self) -> &'static str {
        match self {
            Role::Category => "category",
            Role::Vision => "vision",
        }
    }

}



#[derive(Deserialize, Serialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct CompleteRequest {
    pub messages: Vec<ChatMessage>,
    pub grammar: Option<String>,
    pub max_tokens: Option<u32>,
    pub temperature: Option<f32>,
    /// The role the page's transport was made for. Not used: every ask names
    /// its Pigeon, and the Pigeon's file names its base.
    pub role: Option<String>,
    /// Ask for the first token's probability. The category router refuses when
    /// the answer is a guess, and cannot do that without this.
    pub want_confidence: Option<bool>,
    /// The Pigeon this ask is (D84): with the engine on it is asked instead,
    /// from Patch's nest, with this input and these host values (E20), and
    /// `messages` and `grammar` are not used.
    pub pigeon: Option<PigeonAsk>,
    /// A number the page chose for this ask. With one, the answer is streamed
    /// as `llm-piece` events carrying that number, so the stage line can name
    /// the skill a plan reaches for before the plan is finished. The answer
    /// itself still comes back whole, under its grammar, as always.
    #[serde(default)]
    pub piece: Option<u64>,
}

/// What an `llm-piece` event carries: the page's number and the characters
/// that just arrived, in order.
pub const LLM_PIECE_EVENT: &str = "llm-piece";

#[derive(Deserialize, Debug, Clone)]
pub struct PigeonAsk {
    pub id: String,
    pub input: String,
    #[serde(default)]
    pub values: Option<serde_json::Value>,
}

/// The Pigeons `llm_complete` may ask: Lane A's, which answer with a label or
/// a plan, and the OCR tidy. Pen, Peek and the tidier have doors of their own.
/// The planner is the trained one from Patch v7, or the four prompted ones in
/// a v6 nest.
/// `patch-second-look` left with its retirement (2026-10-13): the app no longer
/// asks it, so a nest that still carries one is never asked for it.
pub(crate) const LANE_A_PIGEONS: [&str; 9] = [
    "patch-router", "patch-planner-trained", "patch-planner", "patch-planner-runway", "patch-planner-carry", "patch-planner-runway-carry",
    "patch-asks", "patch-focus", "ocr-tidy",
];

#[derive(Serialize)]
pub struct CompleteReply {
    pub text: String,
    pub ms: u64,
    pub tokens: u64,
    pub prompt_tokens: u64,
    /// None when not asked for, or when the server did not return one. Never
    /// substituted with 1.0: a caller gating on confidence must be able to tell
    /// "certain" from "never said".
    pub confidence: Option<f64>,
}

/// Ask one of Lane A's Pigeons (D84). The page names the Pigeon and gives
/// its input and host values; the engine asks it from Patch's nest. The
/// `messages` and `grammar` the page also sends are what the Pigeon's file
/// says, and are not used here.
#[tauri::command]
async fn llm_complete(app: tauri::AppHandle, req: CompleteRequest) -> Result<CompleteReply, String> {
    let p = req.pigeon.ok_or("this ask names no Pigeon, and every model the app asks is a Pigeon")?;
    app.state::<engine::Engine>().touch();
    complete_in_engine_with(&app, p, req.max_tokens, req.piece).await
}

/// One of Lane A's Pigeons, asked through the engine. The reply carries the
/// same fields the server's did; `confidence` is the label's (E18).
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) async fn complete_in_engine<R: tauri::Runtime>(app: &tauri::AppHandle<R>, p: PigeonAsk, max_tokens: Option<u32>) -> Result<CompleteReply, String> {
    complete_in_engine_with(app, p, max_tokens, None).await
}

/// The same, streaming each piece as an `llm-piece` event when `piece` names
/// the ask.
pub(crate) async fn complete_in_engine_with<R: tauri::Runtime>(app: &tauri::AppHandle<R>, p: PigeonAsk, max_tokens: Option<u32>, piece: Option<u64>) -> Result<CompleteReply, String> {
    if !LANE_A_PIGEONS.contains(&p.id.as_str()) {
        return Err(format!("\"{}\" is not one of the Pigeons this door asks", p.id));
    }
    let started = std::time::Instant::now();
    let mut request = serde_json::json!({ "input": p.input, "options": { "stream": piece.is_some() } });
    if let Some(n) = max_tokens {
        request["options"]["max_tokens"] = n.into();
    }
    if let Some(v) = p.values {
        request["values"] = v;
    }
    let ev = inprocess::ask_patch_with(app, &p.id, request, Vec::new(), inprocess::emit_pieces(app, LLM_PIECE_EVENT, piece)).await?;
    let stat = |k: &str| ev["stats"][k].as_u64().unwrap_or(0);
    Ok(CompleteReply {
        text: ev["raw"].as_str().unwrap_or_default().to_string(),
        ms: started.elapsed().as_millis() as u64,
        tokens: stat("answer_tokens"),
        prompt_tokens: stat("prompt_tokens"),
        confidence: ev["confidence"].as_f64(),
    })
}

/// Bring the main window up from the menu bar. The page names no window and no
/// geometry; which window that is, and what showing it means, are decided in
/// `tray.rs`.
#[tauri::command]
async fn open_main_window(app: tauri::AppHandle) -> Result<(), String> {
    tray::show_main(&app);
    Ok(())
}

#[tauri::command]
async fn llm_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    /* Whether the model can be asked, as the engine's status says: there is
       no server to probe. One base answers for every Pigeon, so the page's
       planner and category transports read the same row. */
    let s = app.state::<engine::Engine>().snapshot(&app);
    let row = |r: &engine::RoleStatus| serde_json::json!({ "available": r.phase == engine::Phase::Ready, "model": r.model, "base": "in-process" });
    let mut status = row(&s.category);
    status["category"] = row(&s.category);
    Ok(status)
}

/* ── the web tier ───────────────────────────────────────────────────────────
 *
 * A SECOND narrow command, built the same way as the model one: the page hands
 * over a QUERY, never a URL. Both hosts below are compile-time constants and the
 * query is attached with `query_pairs_mut`, which percent-encodes it — so no
 * input from the page can change which host is contacted, only what is asked.
 *
 * This is the first thing in Pigeon that leaves the machine, so it is worth
 * being exact about what changed and what did not. The webview still has no
 * network: its CSP admits no host and this command is the only way out, exactly
 * as `llm_complete` is the only way to a model. What changed is that the app can
 * now make an outbound request at all — gated in the executor by `webEnabled`
 * and, when set, a per-request confirmation the user has to accept. Neither
 * gate lives here; this function assumes the executor already cleared them.
 *
 * No API key, no account, no telemetry: both endpoints are public and take a
 * bare query string. */
const DDG_ENDPOINT: &str = "https://api.duckduckgo.com/";
const WIKIPEDIA_ENDPOINT: &str = "https://en.wikipedia.org/w/api.php";

#[derive(Deserialize)]
pub struct SearchRequest {
    pub query: String,
}

#[derive(Serialize, Debug)]
pub struct SearchResult {
    pub title: String,
    pub snippet: String,
    pub source: String,
}

#[derive(Serialize, Debug)]
pub struct SearchReply {
    /// A direct answer, when one of the providers has one. None is a normal
    /// outcome and the skill reports it as "not found" rather than inventing.
    pub answer: Option<String>,
    pub source: Option<String>,
    /// Which provider the answer came from — "duckduckgo" or "wikipedia" —
    /// so a reply can say whose words it is showing. None without an answer.
    pub answered_by: Option<&'static str>,
    pub results: Vec<SearchResult>,
    pub ms: u64,
}

/// Whole sentences, up to a readable length. The limit is generous on purpose:
/// trimming to look tidy is exactly how the summary endpoint stopped answering
/// the question, so this errs long and only ever cuts at a full stop.
fn trim_to_sentences(text: &str) -> String {
    const LIMIT: usize = 1400;
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.chars().count() <= LIMIT {
        return clean;
    }
    let cut: String = clean.chars().take(LIMIT).collect();
    match cut.rfind(". ") {
        Some(stop) if stop > 120 => cut[..stop + 1].to_string(),
        _ => clean,
    }
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out.replace("&quot;", "\"").replace("&amp;", "&").replace("&#39;", "'")
}

/// Search the public web for a query. The page cannot name a host.
#[tauri::command]
async fn web_search(req: SearchRequest) -> Result<SearchReply, String> {
    let started = std::time::Instant::now();
    let query = req.query.trim();
    if query.is_empty() {
        return Err("empty query".into());
    }
    let client = http::web();
    let timeout = std::time::Duration::from_secs(15);

    let mut ddg = reqwest::Url::parse(DDG_ENDPOINT).map_err(|e| e.to_string())?;
    ddg.query_pairs_mut()
        .append_pair("q", query)
        .append_pair("format", "json")
        .append_pair("no_html", "1")
        .append_pair("skip_disambig", "1");

    let mut wiki = reqwest::Url::parse(WIKIPEDIA_ENDPOINT).map_err(|e| e.to_string())?;
    wiki.query_pairs_mut()
        .append_pair("action", "query")
        .append_pair("list", "search")
        .append_pair("srsearch", query)
        .append_pair("srlimit", "5")
        .append_pair("format", "json");

    /* NEITHER provider is required, and neither depends on the other's result,
       so they are asked at once rather than one after the other. They fail
       independently — Wikipedia returns 429 readily under any burst — and one
       being down is not a reason to have nothing to say when the other
       answered. So each failure is recorded and carried, and the request only
       fails when BOTH gave nothing; then the recorded reasons are what the
       user is told.

       An HTTP error is still never reported as an empty result. "Nothing on the
       web matched that" when the truth is "rate-limited, never asked" is the
       most misleading thing this command could say. */
    let ddg_lookup = async {
        let mut answer = None;
        let mut source = None;
        if let Ok(r) = client.get(ddg).timeout(timeout).send().await {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                let text = v.get("AbstractText").and_then(|a| a.as_str()).unwrap_or("");
                if !text.trim().is_empty() {
                    answer = Some(text.trim().to_string());
                    source = v
                        .get("AbstractURL")
                        .and_then(|u| u.as_str())
                        .filter(|u| !u.is_empty())
                        .map(|u| u.to_string());
                }
            }
        }
        (answer, source)
    };

    let wiki_search = async {
        let mut results = Vec::new();
        let mut why: Vec<String> = Vec::new();
        match client.get(wiki).send().await {
            Err(e) => why.push(format!("could not reach en.wikipedia.org: {e}")),
            Ok(r) if r.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
                why.push("rate-limited by en.wikipedia.org — try again in a moment".into())
            }
            Ok(r) if !r.status().is_success() => {
                why.push(format!("en.wikipedia.org returned {}", r.status()))
            }
            Ok(wiki_res) => {
                if let Ok(v) = wiki_res.json::<serde_json::Value>().await {
                    if let Some(hits) = v.pointer("/query/search").and_then(|h| h.as_array()) {
                        for h in hits {
                            let title = h.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
                            if title.is_empty() {
                                continue;
                            }
                            results.push(SearchResult {
                                snippet: strip_tags(h.get("snippet").and_then(|t| t.as_str()).unwrap_or("")),
                                source: format!(
                                    "https://en.wikipedia.org/wiki/{}",
                                    title.replace(' ', "_")
                                ),
                                title,
                            });
                        }
                    }
                }
            }
        }
        (results, why)
    };

    let ((mut answer, mut source), (results, why)) = tokio::join!(ddg_lookup, wiki_search);
    let mut answered_by = answer.as_ref().map(|_| "duckduckgo");

    /* The encyclopedia's own opening section for the best-matching page.
       Two things had to be right here and testing found both:

       · DuckDuckGo alone is not enough — it has no abstract for "capital of X".
       · The REST summary endpoint truncates. Asked who governs Virginia it
         described the OFFICE and stopped one sentence short of the name, while
         the full opening section says plainly who holds it.

       Wikidata has this as structured data and was the obvious choice. It is
       not used because it was measurably wrong here — still naming a holder
       whose term had ended, with no end date recorded. Maintained prose beat an
       unmaintained field, which is not what you would guess. */
    if let Some(top) = results.first() {
        let mut intro = match reqwest::Url::parse(WIKIPEDIA_ENDPOINT) {
            Ok(u) => u,
            Err(e) => return Err(e.to_string()),
        };
        intro
            .query_pairs_mut()
            .append_pair("action", "query")
            .append_pair("prop", "extracts")
            .append_pair("exintro", "1")
            .append_pair("explaintext", "1")
            .append_pair("redirects", "1")
            .append_pair("titles", &top.title)
            .append_pair("format", "json");

        if let Ok(r) = client.get(intro).send().await {
            if let Ok(v) = r.json::<serde_json::Value>().await {
                let extract = v
                    .pointer("/query/pages")
                    .and_then(|p| p.as_object())
                    .and_then(|pages| pages.values().next())
                    .and_then(|page| page.get("extract"))
                    .and_then(|e| e.as_str())
                    .unwrap_or("");
                if !extract.trim().is_empty() {
                    answer = Some(trim_to_sentences(extract));
                    source = Some(top.source.clone());
                    answered_by = Some("wikipedia");
                }
            }
        }
    }

    /* Both silent. If either said WHY, that is the honest thing to report; only
       when both simply had nothing is this really "no results". */
    if answer.is_none() && results.is_empty() {
        return Err(if why.is_empty() { "no results".into() } else { why.join("; ") });
    }
    Ok(SearchReply { answer, source, answered_by, results, ms: started.elapsed().as_millis() as u64 })
}

#[cfg(test)]
mod search_reply_tests {
    use super::*;

    /// The page reads `answered_by` by that name; a rename in Rust would leave
    /// every look-up unattributed without anything failing loudly.
    #[test]
    fn a_search_reply_names_who_answered() {
        let reply = SearchReply {
            answer: Some("Tokyo".into()),
            source: Some("https://en.wikipedia.org/wiki/Tokyo".into()),
            answered_by: Some("wikipedia"),
            results: vec![],
            ms: 3,
        };
        let v = serde_json::to_value(&reply).unwrap();
        assert_eq!(v["answered_by"], "wikipedia");
        let none = SearchReply { answer: None, source: None, answered_by: None, results: vec![], ms: 0 };
        assert!(serde_json::to_value(&none).unwrap()["answered_by"].is_null());
    }
}

/* ── reading an image ───────────────────────────────────────────────────────
 *
 * A THIRD narrow command, and the first to take something that is not text: the
 * page hands over the BYTES of an image and gets back the text a classical OCR
 * engine found in them. No model is involved — this is the Mac's own Vision
 * recogniser, through the bundled `pigeon-eye` (or Tesseract, found as
 * `llama-server` is found, when a person names one: see `find_reader`), run as
 * a child process with the image on stdin and the text on stdout. The image is never written to disk, and the page
 * cannot name the engine, a path or a language: the argument list below is a
 * constant.
 *
 * Why bytes and not a path: the webview has no filesystem, and a command that
 * took a path would be one. A dropped or pasted file is read by the page into
 * memory and sent as the raw IPC body, which is the one kind of payload that
 * says nothing about where it came from.
 *
 * What comes back is a READING, not an answer. The page shows it beside the
 * question, lets the user correct it, and only then sends it — through the same
 * router and planner as anything typed. Nothing here is in the reply path. */
const TESSERACT_ENV: &str = "PIGEON_TESSERACT";
/// An app opened from Finder has `/usr/bin:/bin:/usr/sbin:/sbin` for a PATH
/// (see `train.command` and the commit that found this), so the bundled app
/// would never see Homebrew's binary without these.
const TESSERACT_WELL_KNOWN: [&str; 3] = [
    "/opt/homebrew/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/usr/bin/tesseract",
];
/// `--psm 6` reads the image as one uniform block of text. The default (3,
/// fully automatic layout) reorders and drops lines on the screenshots of chat,
/// code and paragraphs this is for; 6 is what was checked on real images. It
/// is a constant so that changing it is one line and the page cannot.
const TESSERACT_ARGS: [&str; 4] = ["stdin", "stdout", "--psm", "6"];
const OCR_MAX_BYTES: usize = 20 * 1024 * 1024;
const OCR_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
/// The page checks whether this command exists by sending nothing and looking
/// for this exact refusal — the same contract `web_search` keeps with "empty
/// query". It must be returned BEFORE any lookup or spawn.
const OCR_EMPTY: &str = "empty image";

#[derive(Serialize, Debug)]
pub struct OcrReply {
    pub text: String,
    pub ms: u64,
    /// "tesseract 5.5.0", for the rail and the trace. Never a path.
    pub engine: String,
    pub bytes: usize,
}

pub(crate) fn is_executable_file(p: &std::path::Path) -> bool {
    let Ok(meta) = std::fs::metadata(p) else { return false };
    if !meta.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        meta.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Where the engine is. The environment may name one — the same courtesy
/// `LLAMA_SERVER` gets in `scripts/models.mjs` — and a value that is not an
/// executable file is ignored rather than trusted. Then PATH, then the well-known places. The page has no
/// say at any step.
fn find_tesseract() -> Option<std::path::PathBuf> {
    if let Ok(over) = std::env::var(TESSERACT_ENV) {
        let p = std::path::PathBuf::from(over);
        if is_executable_file(&p) {
            return Some(p);
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join("tesseract");
            if is_executable_file(&p) {
                return Some(p);
            }
        }
    }
    TESSERACT_WELL_KNOWN
        .iter()
        .map(std::path::PathBuf::from)
        .find(|p| is_executable_file(p))
}

/// Run a child with a body on stdin, collecting both streams, and kill it if it
/// outlives `timeout`. Three threads because a child that writes before it has
/// drained stdin would otherwise deadlock against a 20 MB body.
fn run_with_stdin(
    bin: &std::path::Path,
    args: &[&str],
    stdin_bytes: Vec<u8>,
    timeout: std::time::Duration,
) -> Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>), String> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};

    let mut child = Command::new(bin)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("could not start {}: {e}", bin.display()))?;

    let mut stdin = child.stdin.take().ok_or("no stdin on the child")?;
    let mut stdout = child.stdout.take().ok_or("no stdout on the child")?;
    let mut stderr = child.stderr.take().ok_or("no stderr on the child")?;

    let writer = std::thread::spawn(move || {
        // A broken pipe here means the child gave up early; its exit status and
        // stderr will say why, so the write error itself is not the story.
        let _ = stdin.write_all(&stdin_bytes);
        drop(stdin);
    });
    let out_reader = std::thread::spawn(move || {
        let mut v = Vec::new();
        let _ = stdout.read_to_end(&mut v);
        v
    });
    let err_reader = std::thread::spawn(move || {
        let mut v = Vec::new();
        let _ = stderr.read_to_end(&mut v);
        v
    });

    let started = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() > timeout => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!(
                    "{} took longer than {} s",
                    bin.file_name().and_then(|n| n.to_str()).unwrap_or("the engine"),
                    timeout.as_secs()
                ));
            }
            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(25)),
            Err(e) => return Err(format!("could not wait for the engine: {e}")),
        }
    };
    let _ = writer.join();
    let out = out_reader.join().unwrap_or_default();
    let err = err_reader.join().unwrap_or_default();
    Ok((status, out, err))
}

fn run_tesseract(bin: &std::path::Path, bytes: Vec<u8>) -> Result<String, String> {
    let (status, out, err) = run_with_stdin(bin, &TESSERACT_ARGS, bytes, OCR_TIMEOUT)?;
    if !status.success() {
        /* Junk bytes are an ERROR, never an empty reading. "Found no text" when
           the truth is "that was not an image" is the misleading outcome. */
        let why = String::from_utf8_lossy(&err);
        let first = why
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("it exited with an error");
        return Err(format!("tesseract could not read that: {first}"));
    }
    /* Tesseract ends each page with a form feed. Interior newlines are kept:
       the line structure of a receipt or a list is most of its meaning. */
    let text = String::from_utf8_lossy(&out).replace('\u{c}', "");
    Ok(text.trim_end().to_string())
}

/// "tesseract 5.5.0" — the first line of `--version`, which Tesseract prints
/// on stdout in some builds and stderr in others, so both are read.
///
/// Cached after the first successful read, so an OCR call does not spawn a
/// second process just to name the engine. A failed read is not cached: the
/// next call tries again, as it always did.
fn tesseract_version(bin: &std::path::Path) -> Option<String> {
    static VERSION: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    if let Some(v) = VERSION.get() {
        return Some(v.clone());
    }
    let v = read_tesseract_version(bin)?;
    Some(VERSION.get_or_init(|| v).clone())
}

fn read_tesseract_version(bin: &std::path::Path) -> Option<String> {
    let (_, out, err) =
        run_with_stdin(bin, &["--version"], Vec::new(), std::time::Duration::from_secs(2)).ok()?;
    for stream in [out, err] {
        let s = String::from_utf8_lossy(&stream);
        if let Some(line) = s.lines().map(str::trim).find(|l| l.starts_with("tesseract ")) {
            return Some(line.to_string());
        }
    }
    None
}

/// The whole of the work, blocking and testable without a window.
/// What reads the text: the OS's own recogniser, through the bundled
/// `pigeon-eye` binary (Apple's Vision framework — nothing to install, on
/// every Mac this app runs on), or Tesseract when a person has put one on
/// this Mac and set `PIGEON_TESSERACT` to it. The environment picks
/// Tesseract only by naming it; otherwise Vision, and Tesseract only when
/// the eye is missing from the build.
enum Reader {
    Vision(std::path::PathBuf),
    Tesseract(std::path::PathBuf),
}

const VISION_ENGINE: &str = "Apple Vision";

fn find_reader<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<Reader> {
    if let Ok(over) = std::env::var(TESSERACT_ENV) {
        let p = std::path::PathBuf::from(over);
        if is_executable_file(&p) {
            return Some(Reader::Tesseract(p));
        }
    }
    if let Ok(eye) = play::eye_path(app) {
        return Some(Reader::Vision(eye));
    }
    find_tesseract().map(Reader::Tesseract)
}

fn reader_name(r: &Reader) -> String {
    match r {
        Reader::Vision(_) => VISION_ENGINE.into(),
        Reader::Tesseract(bin) => tesseract_version(bin).unwrap_or_else(|| "tesseract".into()),
    }
}

/// The eye's `ocr` subcommand: bytes on stdin, one JSON line back.
fn run_vision(bin: &std::path::Path, bytes: Vec<u8>) -> Result<String, String> {
    let (status, out, err) = run_with_stdin(bin, &["ocr"], bytes, OCR_TIMEOUT)?;
    let text = String::from_utf8_lossy(&out);
    let last = text.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(last).unwrap_or(serde_json::Value::Null);
    if !status.success() || v["type"] == "error" {
        let why = v["message"].as_str().map(String::from).unwrap_or_else(|| {
            String::from_utf8_lossy(&err).lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("it stopped").to_string()
        });
        return Err(format!("the picture could not be read — {why}"));
    }
    Ok(v["text"].as_str().unwrap_or_default().trim_end().to_string())
}

fn ocr_bytes(reader: Option<Reader>, bytes: Vec<u8>) -> Result<OcrReply, String> {
    if bytes.is_empty() {
        return Err(OCR_EMPTY.into());
    }
    if bytes.len() > OCR_MAX_BYTES {
        return Err(format!(
            "image is {} MB; the limit is {} MB",
            bytes.len() / (1024 * 1024),
            OCR_MAX_BYTES / (1024 * 1024)
        ));
    }
    let reader = reader.ok_or("Pigeon can’t read pictures on this Mac — the text reader is missing from this build")?;
    let started = std::time::Instant::now();
    let len = bytes.len();
    let text = match &reader {
        Reader::Vision(eye) => run_vision(eye, bytes)?,
        Reader::Tesseract(bin) => run_tesseract(bin, bytes)?,
    };
    Ok(OcrReply { text, ms: started.elapsed().as_millis() as u64, engine: reader_name(&reader), bytes: len })
}

/// Read the text in an image. The page sends the bytes as the raw IPC body and
/// nothing else — there is no field a path could arrive in.
#[tauri::command]
async fn ocr_image<R: tauri::Runtime>(app: tauri::AppHandle<R>, request: tauri::ipc::Request<'_>) -> Result<OcrReply, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(b) => b.clone(),
        tauri::ipc::InvokeBody::Json(_) => return Err("expected image bytes, not JSON".into()),
    };
    tauri::async_runtime::spawn_blocking(move || ocr_bytes(find_reader(&app), bytes))
        .await
        .map_err(|e| e.to_string())?
}

/// Is there an engine at all? The rail asks once at startup so it can show the
/// image button only when a paste would work, and say which engine it is.
#[tauri::command]
async fn ocr_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<serde_json::Value, String> {
    let found = tauri::async_runtime::spawn_blocking(move || find_reader(&app).map(|r| (reader_name(&r), r)))
        .await
        .map_err(|e| e.to_string())?;
    Ok(match found {
        Some((engine, reader)) => serde_json::json!({
            "available": true,
            "engine": engine,
            /* Outward only, for the rail's tooltip. Nothing path-shaped goes
               the other way. */
            "path": match reader { Reader::Vision(p) | Reader::Tesseract(p) => p.display().to_string() },
        }),
        None => serde_json::json!({ "available": false, "engine": null, "path": null }),
    })
}

/// Restart, from the page's "Restart now" after a Patch update lands. Takes
/// nothing; what it restarts is this app.
#[tauri::command]
async fn app_restart<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let up = app.clone();
    app.run_on_main_thread(move || {
        up.state::<engine::Engine>().sleep_all(Some(&up));
        up.state::<inprocess::InProcess>().sleep();
        up.restart();
    })
    .map_err(|e| e.to_string())
}

/// The main window, asked to go to the menu bar by its own page — the tip
/// sheet's "Got it" — which is the same thing ⌘W does. Takes nothing.
#[tauri::command]
async fn main_hide<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let up = app.clone();
    app.run_on_main_thread(move || go_to_the_menu_bar(&up)).map_err(|e| e.to_string())
}

/// What closing the window means: remembered, hidden, the models asleep,
/// the Dock icon gone. One function, so ⌘W, the red button and the tip
/// sheet cannot drift apart.
fn go_to_the_menu_bar<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(w) = app.get_webview_window("main") {
        geometry::remember(app, &w);
        let _ = w.hide();
    }
    app.state::<engine::Engine>().sleep_all(Some(app));
    app.state::<inprocess::InProcess>().sleep();
    tray::went_to_the_menu_bar(app);
}

/// Whether the person has been told, once, that closing the window is not
/// quitting. A marker file in the app's data folder, not a setting the page
/// keeps: the page is what is about to be hidden.
fn close_tip_shown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> bool {
    weights::app_subdir(app, "").map(|d| d.join("close-tip-shown").is_file()).unwrap_or(true)
}

fn mark_close_tip_shown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Ok(d) = weights::app_subdir(app, "") {
        let _ = std::fs::write(d.join("close-tip-shown"), b"");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        /* Registered with no shortcuts of its own; the one chord is added in
           setup, where a refusal can be reported and survived. */
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(play::Play::default())
        .manage(engine::Engine::new())
        .manage(inprocess::InProcess::default())
        .manage(download::Downloads::new())
        .manage(pigeon::OpenedPigeons::default())
        .manage(pigeon::HeldImports::default())
        .manage(patch::PatchState::default())
        /* The menus at the top of the screen. The Developer menu starts hidden;
           the page shows it if the person switched it on (appmenu.rs). */
        .menu(|app| appmenu::build(app, false))
        .on_menu_event(|app, event| appmenu::on_event(app, event))
        /* The one custom scheme: Patch's code, from memory, to our own three
           windows. Registered before setup so the page never sees a window
           without it; it answers 503 until selection has run. */
        .register_uri_scheme_protocol(patch::SCHEME, patch::scheme_handler)
        .setup(|app| {
            /* The log first, so everything after it is in the file. A Mac
               with no data folder still runs; it just keeps no log. */
            match weights::app_subdir(app.handle(), log::DIR).and_then(log::start) {
                Ok(()) => log::launch(app.handle()),
                Err(e) => eprintln!("log: not kept — {e}"),
            }
            /* Where the window was last time, before it is shown. Nothing the
               page is party to: see geometry.rs for why it is Rust talking to
               itself rather than another command. */
            if let Some(w) = app.get_webview_window("main") {
                geometry::restore(app.handle(), &w);
                /* The first frame in the page's own colour: the saved theme,
                   or the Mac's when the setting says to match it. Without this
                   a dark page opens on a flash of light paper.
                   The window itself takes the same choice, so its title bar
                   is drawn dark on dark or light on light (appearance.rs). */
                appearance::apply(&w, store::saved_theme(app.handle()).as_deref());
            }
            /* Before the engine loads anything: a Pigeon imported by an older
               build may carry a sidecar with no contract, and the file it came
               from is kept precisely so that can be put right. */
            /* The sealed base registry this build ships with is opened first,
               so a failure is logged at launch rather than at the first import
               (format §7.4, D44, D73). */
            let _ = pigeon::registries();
            pigeon::repair_sidecars(app.handle());
            /* Then, on a thread of its own: hash each base an installed Pigeon
               names that this Mac has never hashed, and refresh the notes that
               said it was not confirmed. */
            pigeon::confirm_bases_at_launch(app.handle().clone());
            /* Which pack is Patch, decided before the engine can wake. The
               choice is made here and now; his adapter is extracted on a
               thread, and a wake waits for it. */
            patch::select_at_launch(app.handle());
            /* Patch in the menu bar. A failure here is reported and survived:
               an app that will not start because its tray icon would not build
               is worse than an app with no tray icon. */
            if let Err(e) = tray::build(app.handle()) {
                plog!("pigeon", "{e}");
            }
            /* ⌘⇧P, from anywhere: the summon bar. Survived the same way — a
               chord another app already holds is a line on stderr and a menu
               item that still works, not a Pigeon that will not start. */
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
                let chord = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyP);
                let held = app.global_shortcut().on_shortcut(chord, |app, _, event| {
                    if event.state == ShortcutState::Pressed {
                        bar::toggle(app);
                    }
                });
                if let Err(e) = held {
                    plog!("pigeon", "{} could not be registered: {e}", bar::CHORD_LABEL);
                }
            }
            bar::summon_at_launch_if_asked(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            llm_complete,
            llm_status,
            web_search,
            store::load_state,
            store::save_state,
            store::keep_unreadable_state,
            ocr_image,
            ocr_status,
            engine::engine_status,
            engine::engine_wake,
            engine::engine_warm,
            engine::engine_sleep,
            engine::engine_set_idle_unload,
            download::models_status,
            modelstore::models_on_this_mac,
            modelstore::models_remove,
            download::models_download,
            download::models_download_picture,
            download::models_download_projector,
            download::models_download_embedding,
            download::models_cancel,
            chat::chat_complete,
            chat::personas_list,
            task::task_complete,
            task::tasks_list,
            capture::screen_capture,
            capture::screen_capture_status,
            pigeon::pigeon_take_opens,
            pigeon::pigeon_run,
            play::play_permission,
            play::play_ask,
            play::play_open_settings,
            play::play_windows,
            play::play_preview,
            play::play_key_test,
            play::play_start,
            play::play_stop,
            play::play_status,
            playhud::play_hud,
            pigeon::pigeon_check_ride,
            pigeon::pigeon_use_new_revision,
            pigeon::pigeon_save_drawing,
            pigeon::pigeon_example_drawings,
            pigeon::pigeon_contents,
            pigeon::pigeon_inspect_pick,
            appmenu::set_dev_menu,
            pigeon::pigeon_add,
            pigeon::pigeon_remove,
            patch::patch_status,
            open_main_window,
            tray::popover_hide,
            main_hide,
            app_restart,
            store::save_chat,
            store::remove_chat,
            store::settings_peek,
            appearance::window_theme,
            tray::popover_show,
            bar::bar_hide,
            bar::bar_show,
            bar::bar_fit,
            bar::bar_bubbles,
            log::log_event,
            log::diagnostics_log,
            log::diagnostics_copy,
            log::logs_save,
            log::logs_reveal
        ])
        // Exit path 1: the main window is destroyed. Only "main" — a second
        // window (the menu-bar popover, later) must not sleep the models out
        // from under the window that is using them.
        .on_window_event(|window, event| {
            /* The popover behaves like a menu: it goes away when you look
               somewhere else. Closing it is not quitting and does not touch
               the models — only the main window's destruction does that. */
            /* The summon bar goes away the same way, for the same reason. */
            if window.label() == tray::POPOVER || window.label() == bar::BAR {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
                return;
            }
            if window.label() != "main" {
                return;
            }
            match event {
                /* Closing the window does NOT quit: Pigeon stays in the menu
                   bar. What it must not do is stay there holding weights, so
                   the models go to sleep on the way out and the app returns to
                   being the router and 307 pure functions — §5.6's "resident
                   means resident AND empty". Quit is in the tray menu, and
                   Cmd+Q still works. */
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    /* The first time only: the window stays, and the page says
                       where Pigeon goes when it closes — because an app whose
                       window and Dock icon both vanish on ⌘W looks, to anyone
                       not told, like an app that crashed. "Got it" on that
                       sheet calls `main_hide`, which is the branch below. */
                    if !close_tip_shown(&app) {
                        mark_close_tip_shown(&app);
                        if let Some(w) = app.get_webview_window("main") {
                            use tauri::Emitter;
                            let _ = w.emit("close-tip", ());
                        }
                        return;
                    }
                    go_to_the_menu_bar(&app);
                }
                /* The Mac, or the setting, changed appearance: the transparent
                   title bar's ground follows, so its ink stays readable. */
                tauri::WindowEvent::ThemeChanged(theme) => {
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        appearance::paint(&w, *theme == tauri::Theme::Dark);
                    }
                }
                /* Still handled: a window destroyed some other way must not
                   leave a server behind either. */
                tauri::WindowEvent::Destroyed => {
                    let app = window.app_handle().clone();
                    app.state::<engine::Engine>().sleep_all(Some(&app));
                    app.state::<inprocess::InProcess>().sleep();
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Pigeon")
        // Exit path 2: the app is exiting (Cmd+Q). Path 3 is Engine's Drop.
        .run(|app, event| match event {
            tauri::RunEvent::Exit => {
                if let Some(w) = app.get_webview_window("main") {
                    geometry::remember(app, &w);
                }
                app.state::<download::Downloads>().cancel();
                app.state::<engine::Engine>().sleep_all(Some(app));
                // Before the process exits: Metal aborts one that still holds
                // GPU memory (pigeon-engine's NOTES.md).
                app.state::<inprocess::InProcess>().sleep();
            }
            // Finder double-click, or a `.pigeon`/`.nest` dropped on the Dock
            // icon — registered in `tauri.conf.json`'s `fileAssociations`.
            // Routed through the exact same import pipeline as the picker
            // button (`pigeon::handle_opened`, then the Meet sheet), so a file
            // opened this way is validated and refused exactly as one chosen
            // by hand would be.
            tauri::RunEvent::Opened { urls } => {
                let paths: Vec<std::path::PathBuf> = urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
                pigeon::handle_opened(app.clone(), paths);
            }
            /* Launchpad, Spotlight or the Dock, with the window closed: macOS
               asks the running app to reopen. Without this arm nothing would
               appear, and the only way back would be the menu-bar bird. */
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { has_visible_windows, .. } => {
                if !has_visible_windows {
                    tray::show_main(app);
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_empty_query_is_refused_without_asking_anyone() {
        let err = web_search(SearchRequest { query: "   ".into() })
            .await
            .expect_err("an empty query must be refused");
        assert!(err.contains("empty query"), "got {err:?}");
    }

    /// The live one. Ignored by default so `npm test` stays offline, and run with
    /// `cargo test -- --ignored` when the transport itself is in question.
    ///
    /// This exists because of a failure no offline test could have caught:
    /// reqwest was built with no TLS backend, which was correct while the only
    /// thing it contacted was http://127.0.0.1, and meant every https request
    /// failed at connect the moment the web tier made one. The unit tests all
    /// passed throughout.
    #[tokio::test]
    #[ignore]
    async fn really_reaches_the_web() {
        let reply = web_search(SearchRequest { query: "Ada Lovelace".into() })
            .await
            .expect("the web tier should reach its providers");
        assert!(
            reply.answer.is_some() || !reply.results.is_empty(),
            "reached the providers but got nothing back"
        );
        if let Some(src) = &reply.source {
            assert!(src.starts_with("https://"), "source should be a url, got {src}");
        }
    }

    /// Markup in a search snippet is Wikipedia's, not ours, and it is rendered
    /// as text — so it is stripped here rather than escaped at every use.
    #[test]
    fn snippets_come_back_as_plain_text() {
        let got = strip_tags("The <span class=\"searchmatch\">governor</span> of &amp; Maryland");
        assert_eq!(got, "The governor of & Maryland");
    }

    /// The engine is found here, never named by the page — `ocr_image` takes
    /// the raw body and no other argument, so there is no field a path could
    /// arrive in. What the ENVIRONMENT may name is checked before it is
    /// trusted: a missing file or a directory is ignored, the way a bad port
    /// is; an executable file is honoured. One test, because the variable is
    /// process-wide and the suite runs in parallel.
    #[test]
    fn the_engine_is_never_where_the_page_says() {
        for bad in ["/nonexistent/tesseract", "/tmp", ""] {
            std::env::set_var(TESSERACT_ENV, bad);
            let found = find_tesseract();
            assert_ne!(
                found.as_deref().map(|p| p.to_string_lossy().into_owned()),
                Some(bad.to_string()),
                "{bad:?} must not be taken as the engine"
            );
        }
        std::env::set_var(TESSERACT_ENV, "/bin/ls");
        assert_eq!(
            find_tesseract().as_deref(),
            Some(std::path::Path::new("/bin/ls")),
            "an executable file named by the environment is honoured"
        );
        std::env::remove_var(TESSERACT_ENV);
    }

    /// Nothing in → the fixed refusal, before any lookup or spawn — the page's
    /// health check depends on the wording. And a body over the cap is
    /// refused with the cap in the message.
    /// The eye binary the checkout carries, which is the text reader.
    fn eye() -> Option<Reader> {
        let p = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries/pigeon-eye-aarch64-apple-darwin");
        p.is_file().then_some(Reader::Vision(p))
    }

    #[test]
    fn an_empty_image_is_refused_without_spawning() {
        let err = ocr_bytes(eye(), Vec::new()).expect_err("empty must be refused");
        assert!(err.contains(OCR_EMPTY), "got {err:?}");
        let err = ocr_bytes(eye(), vec![0u8; OCR_MAX_BYTES + 1]).expect_err("over the cap must be refused");
        assert!(err.contains("20 MB"), "got {err:?}");
        let err = ocr_bytes(None, b"png".to_vec()).expect_err("no reader is said plainly");
        assert!(err.contains("can’t read pictures"), "got {err:?}");
    }

    /// The real thing: the OS's own recogniser reads the fixture, with
    /// nothing installed. Tesseract, when a person has it, reads the same.
    #[test]
    fn a_png_round_trips_through_the_text_reader() {
        let png = include_bytes!("../tests/fixtures/hello.png").to_vec();
        let mut readers = vec![eye().expect("the eye binary is built into this checkout")];
        readers.extend(find_tesseract().map(Reader::Tesseract));
        for reader in readers {
            let name = reader_name(&reader);
            let reply = ocr_bytes(Some(reader), png.clone()).expect("the fixture should read");
            let text = reply.text.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ");
            assert!(text.contains("pigeon"), "{name}: got {:?}", reply.text);
            assert!(text.contains("42"), "{name}: got {:?}", reply.text);
            assert_eq!(reply.engine, name);
            assert!(reply.bytes > 0);
        }
    }

    /// Bytes that are not an image are an ERROR, not an empty reading. "Found no
    /// text" when the truth is "that was not an image" is the misleading one.
    #[test]
    fn junk_bytes_are_an_error_not_an_empty_reading() {
        let err = ocr_bytes(eye(), b"not an image".to_vec()).expect_err("junk must fail");
        assert!(err.contains("could not be read") && err.contains("not an image"), "got {err:?}");
        if let Some(t) = find_tesseract() {
            let err = ocr_bytes(Some(Reader::Tesseract(t)), b"not an image".to_vec()).expect_err("junk must fail");
            assert!(err.contains("could not read"), "got {err:?}");
        }
    }

    /// The reader is the OS's unless the environment names Tesseract.
    #[test]
    fn the_os_reader_is_the_default_and_tesseract_only_by_name() {
        std::env::remove_var(TESSERACT_ENV);
        assert_eq!(reader_name(&eye().unwrap()), VISION_ENGINE);
        if let Some(t) = find_tesseract() {
            std::env::set_var(TESSERACT_ENV, &t);
            assert!(matches!(Reader::Tesseract(t.clone()), Reader::Tesseract(_)));
            std::env::remove_var(TESSERACT_ENV);
        }
    }
}

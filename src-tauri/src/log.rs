//! The log file: what a released Pigeon did, kept on this Mac.
//!
//! A released app's stderr goes nowhere, so every issue used to need a probe
//! build. The app's data folder now holds `logs/pigeon-YYYY-MM-DD.log`: one file
//! per local day, plain UTF-8, one line per event, each line stamped to the
//! millisecond with its UTC offset. Files from more than 30 days ago are deleted
//! at launch. A day's file is capped at 20 MB; past that, its oldest lines go,
//! and a line says how many.
//!
//! Writing never holds up an ask. A line goes into a bounded queue and one
//! thread writes it; when the queue is full the line is dropped and counted, and
//! the count is written as a line of its own as soon as the writer catches up.
//!
//! What a line may hold is decided here, not by the page: `log_event` cuts every
//! text the page sends to 80 characters (the plan alone is kept whole, since the
//! arguments it chose are the point), drops pictures, and leaves out anything
//! under `~/.airoplane-mode`. Saving the logs (Settings › Developer) or copying
//! diagnostics is the only way any of it leaves the Mac.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::Value;

/// The folder inside the app's data folder.
pub const DIR: &str = "logs";
/// Days kept, today included.
pub const KEEP_DAYS: i64 = 30;
/// A day's file is cut back once it passes this.
pub const DAY_CAP: u64 = 20 * 1024 * 1024;
/// Lines waiting for the writer before new ones are dropped.
pub const QUEUE: usize = 4096;
/// How much of a text the page sends is kept.
pub const TEXT_CHARS: usize = 80;
/// How much of a sentence the app showed (a refusal, a warning) is kept.
pub const SENTENCE_CHARS: usize = 300;
/// No single line is longer than this; a plan that big is cut.
pub const LINE_BYTES: usize = 16 * 1024;
/// The longest range Save logs… joins.
pub const MAX_RANGE_DAYS: i64 = 366;

// ── dates, without a date crate ──────────────────────────────────────────

/// Days since 1970-01-01 for a proleptic Gregorian date (Hinnant's algorithm).
pub fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The date `days` after 1970-01-01.
pub fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { yoe + era * 400 + 1 } else { yoe + era * 400 }, m, d)
}

/// "2026-10-15" for a day number.
pub fn date_string(days: i64) -> String {
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

/// The day number of "2026-10-15", or None for anything else.
pub fn parse_date(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let y: i64 = s[0..4].parse().ok()?;
    let m: u32 = s[5..7].parse().ok()?;
    let d: u32 = s[8..10].parse().ok()?;
    if !(1..=12).contains(&m) || d == 0 || d > 31 {
        return None;
    }
    let days = days_from_civil(y, m, d);
    (date_string(days) == s).then_some(days)
}

/// The day's file name.
pub fn file_name(days: i64) -> String {
    format!("pigeon-{}.log", date_string(days))
}

/// The day a log file is for, from its name.
pub fn day_of_file(name: &str) -> Option<i64> {
    parse_date(name.strip_prefix("pigeon-")?.strip_suffix(".log")?)
}

/// A moment: milliseconds since the epoch, and the local offset then.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Moment {
    pub ms: i64,
    pub offset_s: i64,
}

impl Moment {
    pub fn now() -> Moment {
        let ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Moment { ms, offset_s: local_offset(ms / 1000) }
    }

    /// The local day this moment falls on.
    pub fn day(&self) -> i64 {
        (self.ms + self.offset_s * 1000).div_euclid(86_400_000)
    }

    /// "2026-10-15T11:44:03.123+01:00".
    pub fn stamp(&self) -> String {
        let local = self.ms + self.offset_s * 1000;
        let day = local.div_euclid(86_400_000);
        let in_day = local.rem_euclid(86_400_000);
        let (h, mi, s, ms) = (in_day / 3_600_000, in_day / 60_000 % 60, in_day / 1000 % 60, in_day % 1000);
        let sign = if self.offset_s < 0 { '-' } else { '+' };
        let off = self.offset_s.abs();
        format!("{}T{h:02}:{mi:02}:{s:02}.{ms:03}{sign}{:02}:{:02}", date_string(day), off / 3600, off / 60 % 60)
    }
}

/// The epoch milliseconds a line's stamp names, or None if it has none.
pub fn parse_stamp(line: &str) -> Option<i64> {
    let s = line.get(0..29)?;
    let day = parse_date(&s[0..10])?;
    if &s[10..11] != "T" || &s[19..20] != "." {
        return None;
    }
    let num = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let (h, mi, sec, ms) = (num(11..13)?, num(14..16)?, num(17..19)?, num(20..23)?);
    let sign = match &s[23..24] {
        "+" => 1,
        "-" => -1,
        _ => return None,
    };
    let off = sign * (num(24..26)? * 3600 + num(27..29)? * 60);
    Some(day * 86_400_000 + ((h * 60 + mi) * 60 + sec) * 1000 + ms - off * 1000)
}

#[cfg(unix)]
fn local_offset(epoch_s: i64) -> i64 {
    let t = epoch_s as libc::time_t;
    let mut tm: libc::tm = unsafe { std::mem::zeroed() };
    // SAFETY: localtime_r writes only into `tm`, which outlives the call.
    let ok = unsafe { !libc::localtime_r(&t, &mut tm).is_null() };
    if ok { tm.tm_gmtoff as i64 } else { 0 }
}

#[cfg(not(unix))]
fn local_offset(_epoch_s: i64) -> i64 {
    0
}

// ── lines ────────────────────────────────────────────────────────────────

/// One line: stamp, kind, text, on one line however the text was written.
pub fn format_line(at: Moment, kind: &str, text: &str) -> String {
    let mut line = format!("{} {kind} {}", at.stamp(), text.replace('\r', "").replace('\n', "\\n"));
    cut_bytes(&mut line, LINE_BYTES);
    line
}

fn cut_bytes(s: &mut String, max: usize) {
    if s.len() > max {
        let mut end = max.saturating_sub(3);
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push('…');
    }
}

/// The first `n` characters of `s`, with an ellipsis when there was more.
pub fn first_chars(s: &str, n: usize) -> String {
    match s.char_indices().nth(n) {
        Some((i, _)) => format!("{}…", &s[..i]),
        None => s.to_string(),
    }
}

/// What the page sent, made fit for the file: every text cut to 80
/// characters, except inside `plan` and a shown `sentence` (300); pictures and anything under
/// `~/.airoplane-mode` left out wherever they are.
pub fn sanitize(fields: &Value) -> Value {
    fn walk(v: &Value, whole: bool) -> Value {
        match v {
            Value::String(s) => {
                if s.starts_with("data:") {
                    Value::String("[picture left out]".into())
                } else if s.contains(".airoplane-mode") {
                    Value::String("[left out: ~/.airoplane-mode]".into())
                } else if whole {
                    Value::String(s.clone())
                } else {
                    Value::String(first_chars(s, TEXT_CHARS))
                }
            }
            Value::Array(a) => Value::Array(a.iter().map(|x| walk(x, whole)).collect()),
            Value::Object(o) => Value::Object(
                o.iter()
                    .map(|(k, x)| match (k.as_str(), x) {
                        /* A sentence the app itself showed (a refusal, a
                           warning, a notice) is kept to 300 characters. */
                        ("sentence", Value::String(t)) if !whole => (k.clone(), walk(&Value::String(first_chars(t, SENTENCE_CHARS)), true)),
                        _ => (k.clone(), walk(x, whole || k == "plan")),
                    })
                    .collect(),
            ),
            other => other.clone(),
        }
    }
    walk(fields, false)
}

/// A kind the page may name: a short lowercase word, else "page".
pub fn page_kind(kind: &str) -> &str {
    let ok = !kind.is_empty() && kind.len() <= 24 && kind.bytes().all(|b| b.is_ascii_lowercase() || b == b'-');
    if ok { kind } else { "page" }
}

// ── the file ─────────────────────────────────────────────────────────────

/// Writes lines into their day's file and keeps it under the cap.
pub struct Writer {
    dir: PathBuf,
    cap: u64,
    day: Option<i64>,
    file: Option<File>,
    size: u64,
}

impl Writer {
    pub fn new(dir: PathBuf, cap: u64) -> Writer {
        Writer { dir, cap, day: None, file: None, size: 0 }
    }

    /// Appends one line (its day read from its own stamp).
    pub fn append(&mut self, line: &str) -> std::io::Result<()> {
        let day = line.get(0..10).and_then(parse_date).unwrap_or_else(|| Moment::now().day());
        if self.day != Some(day) || self.file.is_none() {
            let path = self.dir.join(file_name(day));
            let f = OpenOptions::new().create(true).append(true).open(&path)?;
            self.size = f.metadata().map(|m| m.len()).unwrap_or(0);
            self.file = Some(f);
            self.day = Some(day);
        }
        let f = self.file.as_mut().expect("opened above");
        f.write_all(line.as_bytes())?;
        f.write_all(b"\n")?;
        self.size += line.len() as u64 + 1;
        if self.size > self.cap {
            self.file = None;
            self.size = trim_file(&self.dir.join(file_name(day)), self.cap / 2)?;
        }
        Ok(())
    }
}

/// Keeps the newest whole lines of `text` that fit in `keep` bytes, after a
/// line saying how many older ones went. Returns the new text and that count.
pub fn trim_text(text: &str, keep: u64) -> (String, usize) {
    let lines: Vec<&str> = text.lines().collect();
    let mut kept = 0usize;
    let mut bytes = 0u64;
    for l in lines.iter().rev() {
        let n = l.len() as u64 + 1;
        if bytes + n > keep {
            break;
        }
        bytes += n;
        kept += 1;
    }
    let dropped = lines.len() - kept;
    let mut out = String::with_capacity(bytes as usize + 120);
    out.push_str(&format_line(
        Moment::now(),
        "log",
        &format!("{dropped} oldest lines of this day were dropped: the day's file passed {} MB", DAY_CAP / (1024 * 1024)),
    ));
    out.push('\n');
    for l in &lines[dropped..] {
        out.push_str(l);
        out.push('\n');
    }
    (out, dropped)
}

fn trim_file(path: &Path, keep: u64) -> std::io::Result<u64> {
    let text = String::from_utf8_lossy(&std::fs::read(path)?).into_owned();
    let (out, _) = trim_text(&text, keep);
    let tmp = path.with_extension("log.tmp");
    std::fs::write(&tmp, &out)?;
    std::fs::rename(&tmp, path)?;
    Ok(out.len() as u64)
}

/// Deletes day files older than `keep_days` before `today`. Returns how many.
pub fn prune(dir: &Path, today: i64, keep_days: i64) -> usize {
    let Ok(entries) = std::fs::read_dir(dir) else { return 0 };
    let mut gone = 0;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if let Some(day) = day_of_file(&name) {
            if day <= today - keep_days && std::fs::remove_file(e.path()).is_ok() {
                gone += 1;
            }
        }
    }
    gone
}

// ── the queue ────────────────────────────────────────────────────────────

/// A queue and the count of lines it had no room for.
pub struct Logger {
    tx: SyncSender<String>,
    dropped: std::sync::Arc<AtomicU64>,
}

impl Logger {
    /// A logger whose writer is not running yet: `run` drains it.
    pub fn unstarted(queue: usize) -> (Logger, Receiver<String>, std::sync::Arc<AtomicU64>) {
        let (tx, rx) = sync_channel(queue);
        let dropped = std::sync::Arc::new(AtomicU64::new(0));
        (Logger { tx, dropped: dropped.clone() }, rx, dropped)
    }

    /// Queues a line, or counts it if there is no room. Never blocks.
    pub fn send(&self, line: String) {
        match self.tx.try_send(line) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) | Err(TrySendError::Disconnected(_)) => {
                self.dropped.fetch_add(1, Ordering::Relaxed);
            }
        }
    }
}

/// The writer's loop: each line in turn, and the count of dropped lines
/// written as soon as there is one to report. Returns when every sender is gone.
pub fn run(rx: Receiver<String>, dropped: &AtomicU64, mut w: Writer) {
    let report = |w: &mut Writer| {
        let n = dropped.swap(0, Ordering::Relaxed);
        if n > 0 {
            let _ = w.append(&format_line(Moment::now(), "log", &format!("{n} lines were dropped: the queue was full")));
        }
    };
    loop {
        match rx.recv_timeout(Duration::from_secs(1)) {
            Ok(line) => {
                report(&mut w);
                let _ = w.append(&line);
            }
            Err(RecvTimeoutError::Timeout) => report(&mut w),
            Err(RecvTimeoutError::Disconnected) => {
                report(&mut w);
                return;
            }
        }
    }
}

static LOG: OnceLock<(Logger, PathBuf)> = OnceLock::new();

/// Opens the log in `dir`, deletes days past keeping, and starts the writer.
/// Lines written before this go to stderr only.
pub fn start(dir: PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not make the log folder: {e}"))?;
    let gone = prune(&dir, Moment::now().day(), KEEP_DAYS);
    let (logger, rx, dropped) = Logger::unstarted(QUEUE);
    let w = Writer::new(dir.clone(), DAY_CAP);
    std::thread::Builder::new()
        .name("pigeon-log".into())
        .spawn(move || run(rx, &dropped, w))
        .map_err(|e| e.to_string())?;
    let _ = LOG.set((logger, dir));
    if gone > 0 {
        write("log", &format!("deleted {gone} day files older than {KEEP_DAYS} days"));
    }
    Ok(())
}

/// The log folder, once started.
pub fn dir() -> Option<PathBuf> {
    LOG.get().map(|(_, d)| d.clone())
}

/// One line into the file (not stderr).
pub fn write(kind: &str, text: &str) {
    if let Some((l, _)) = LOG.get() {
        l.send(format_line(Moment::now(), kind, text));
    }
}

/// One line into the file and onto stderr, as `kind: text`.
pub fn emit(kind: &str, text: &str) {
    eprintln!("{kind}: {text}");
    write(kind, text);
}

/// `plog!("patch", "ready v{}", v)`: a line in the log and on stderr.
#[macro_export]
macro_rules! plog {
    ($kind:expr, $($arg:tt)*) => { $crate::log::emit($kind, &format!($($arg)*)) };
}

/// The page's one way into the log: an event of `kind` with its fields,
/// made fit by `sanitize` before it is written. Never fails and never waits.
#[tauri::command]
pub fn log_event(kind: String, fields: Value) {
    let text = serde_json::to_string(&sanitize(&fields)).unwrap_or_default();
    write(page_kind(&kind), &text);
}

/// What Copy diagnostics needs from Rust: the header and the log's last hour.
#[derive(serde::Serialize)]
pub struct Diagnostics {
    pub header: String,
    pub lines: Vec<String>,
}

/// The header and the last 60 minutes of the log, for the page to put on the
/// clipboard beside the chat. Takes nothing; reads only the log folder.
#[tauri::command]
pub fn diagnostics_log<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Diagnostics {
    write("log", "diagnostics copied");
    Diagnostics { header: header(&app), lines: dir().map(|d| tail(&d, Moment::now(), 60)).unwrap_or_default() }
}

/// The most Copy diagnostics puts on the pasteboard.
pub const COPY_BYTES: usize = 8 * 1024 * 1024;

/// Copy diagnostics' last step: the text the page built (diagnostics.js) onto
/// the Mac's pasteboard, by Rust. The page cannot: WebKit lets a page write
/// the clipboard only inside the click itself, and the click has already
/// waited on `diagnostics_log` for the log. Takes a string and returns how
/// many characters went; nothing is sent anywhere.
#[tauri::command]
pub fn diagnostics_copy(text: String) -> Result<usize, String> {
    if text.len() > COPY_BYTES {
        return Err("the diagnostics were too long to copy".into());
    }
    pasteboard_write(&text)?;
    write("log", &format!("diagnostics on the pasteboard, {} characters", text.chars().count()));
    Ok(text.chars().count())
}

#[cfg(target_os = "macos")]
fn pasteboard_write(text: &str) -> Result<(), String> {
    use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
    use objc2_foundation::NSString;
    let pb = NSPasteboard::generalPasteboard();
    pb.clearContents();
    // SAFETY: a static AppKit constant, read once.
    let kind = unsafe { NSPasteboardTypeString };
    if pb.setString_forType(&NSString::from_str(text), kind) { Ok(()) } else { Err("macOS would not take the text onto the pasteboard".into()) }
}

#[cfg(not(target_os = "macos"))]
fn pasteboard_write(_text: &str) -> Result<(), String> {
    Err("copying is only built for macOS".into())
}

// ── reading it back ──────────────────────────────────────────────────────

/// The lines of the last `minutes`, oldest first, from today's file and the
/// day before (an hour can cross midnight).
pub fn tail(dir: &Path, now: Moment, minutes: i64) -> Vec<String> {
    let since = now.ms - minutes * 60_000;
    let mut out = Vec::new();
    for day in [now.day() - 1, now.day()] {
        let Ok(bytes) = std::fs::read(dir.join(file_name(day))) else { continue };
        for line in String::from_utf8_lossy(&bytes).lines() {
            if parse_stamp(line).is_some_and(|t| t >= since && t <= now.ms + 1000) {
                out.push(line.to_string());
            }
        }
    }
    out
}

/// The chosen days' files joined in order under `header`, one divider line
/// per day; a day with no file is named as missing. A range with no files
/// at all says so rather than being empty.
pub fn join_days(dir: &Path, from: i64, to: i64, header: &str) -> Result<String, String> {
    if to < from {
        return Err("the range ends before it starts".into());
    }
    if to - from + 1 > MAX_RANGE_DAYS {
        return Err(format!("a range can be at most {MAX_RANGE_DAYS} days"));
    }
    let mut out = String::new();
    out.push_str(header.trim_end());
    out.push_str("\n\n");
    let mut any = false;
    for day in from..=to {
        match std::fs::read(dir.join(file_name(day))) {
            Ok(bytes) => {
                any = true;
                out.push_str(&format!("===== {} =====\n", date_string(day)));
                let text = String::from_utf8_lossy(&bytes);
                out.push_str(&text);
                if !text.ends_with('\n') {
                    out.push('\n');
                }
            }
            Err(_) => out.push_str(&format!("===== {}: no log for this day =====\n", date_string(day))),
        }
    }
    if !any {
        out.push_str(&format!(
            "\nNo log files exist for {} to {}: Pigeon wrote nothing on those days, or the files were older than {KEEP_DAYS} days and deleted.\n",
            date_string(from),
            date_string(to)
        ));
    }
    Ok(out)
}

/// The saved file's name for a range.
pub fn range_file_name(from: i64, to: i64) -> String {
    format!("pigeon-logs-{}-{}.txt", date_string(from), date_string(to))
}

/// The days a Save logs… choice names: `today`, `7` and `30` end today and
/// count it; `custom` is `from` to `to`, two dates as the page's date fields
/// give them.
pub fn range_days(preset: &str, from: Option<&str>, to: Option<&str>, today: i64) -> Result<(i64, i64), String> {
    match preset {
        "today" => Ok((today, today)),
        "7" => Ok((today - 6, today)),
        "30" => Ok((today - 29, today)),
        "custom" => {
            let day = |d: Option<&str>, which: &str| d.and_then(parse_date).ok_or_else(|| format!("choose a {which} date"));
            let (f, t) = (day(from, "from")?, day(to, "to")?);
            if t < f {
                return Err("the range ends before it starts".into());
            }
            Ok((f, t))
        }
        _ => Err("that is not a range Save logs offers".into()),
    }
}

/// Save logs…: joins the chosen days under the header and writes one file
/// where the person picks in the save dialog. Takes a range word and, for a
/// custom range, two dates — never a path. Returns the file's name, or
/// nothing when the dialog was cancelled.
#[tauri::command]
pub async fn logs_save<R: tauri::Runtime>(app: tauri::AppHandle<R>, range: String, from: Option<String>, to: Option<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (f, t) = range_days(&range, from.as_deref(), to.as_deref(), Moment::now().day())?;
    let dir = dir().ok_or("Pigeon keeps no log on this Mac: its log folder could not be made")?;
    let text = join_days(&dir, f, t, &header(&app))?;
    let picked = app
        .dialog()
        .file()
        .set_title("Save logs")
        .set_file_name(range_file_name(f, t))
        .add_filter("Text", &["txt"])
        .blocking_save_file();
    let Some(picked) = picked else { return Ok(None) };
    let Some(path) = picked.as_path().map(Path::to_path_buf) else {
        return Err("that place can't be written to".into());
    };
    std::fs::write(&path, text.as_bytes()).map_err(|e| format!("couldn't save the logs — {e}"))?;
    write("log", &format!("saved logs {} to {} ({} bytes)", date_string(f), date_string(t), text.len()));
    Ok(path.file_name().map(|n| n.to_string_lossy().into_owned()))
}

/// Show log folder: opens `logs/` in Finder. Takes nothing.
#[tauri::command]
pub fn logs_reveal() -> Result<(), String> {
    let dir = dir().ok_or("Pigeon keeps no log on this Mac: its log folder could not be made")?;
    std::process::Command::new("/usr/bin/open")
        .arg(&dir)
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err("Finder would not open the log folder".into()) })
}

// ── memory ───────────────────────────────────────────────────────────────

/// This process's footprint in MB, as Activity Monitor's Memory column counts
/// it (phys_footprint). None where it cannot be read.
#[cfg(target_os = "macos")]
pub fn footprint_mb() -> Option<u64> {
    let mut info: libc::rusage_info_v2 = unsafe { std::mem::zeroed() };
    // SAFETY: proc_pid_rusage fills `info`, which is the flavor's struct.
    let rc = unsafe {
        libc::proc_pid_rusage(
            std::process::id() as libc::c_int,
            libc::RUSAGE_INFO_V2,
            &mut info as *mut libc::rusage_info_v2 as *mut libc::rusage_info_t,
        )
    };
    (rc == 0).then(|| info.ri_phys_footprint / (1024 * 1024))
}

#[cfg(not(target_os = "macos"))]
pub fn footprint_mb() -> Option<u64> {
    None
}

/// "footprint 537 MB of 16384 MB".
pub fn memory_now() -> String {
    format!(
        "footprint {} of {}",
        footprint_mb().map_or("unknown".into(), |m| format!("{m} MB")),
        crate::hardware::total_ram_mb().map_or("unknown".into(), |m| format!("{m} MB"))
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("pigeon-log-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn at(date: &str, h: i64, offset_s: i64) -> Moment {
        let day = parse_date(date).unwrap();
        Moment { ms: day * 86_400_000 + h * 3_600_000 - offset_s * 1000, offset_s }
    }

    #[test]
    fn dates_go_there_and_back() {
        for s in ["1970-01-01", "2000-02-29", "2026-10-15", "2026-12-31", "2027-01-01"] {
            assert_eq!(date_string(parse_date(s).unwrap()), s);
        }
        assert_eq!(parse_date("2026-02-30"), None);
        assert_eq!(parse_date("2026-1-5"), None);
        assert_eq!(parse_date("2026-10-15").unwrap() - parse_date("2026-09-15").unwrap(), 30);
        assert_eq!(day_of_file("pigeon-2026-10-15.log"), parse_date("2026-10-15"));
        assert_eq!(day_of_file("pigeon-2026-10-15.log.tmp"), None);
    }

    #[test]
    fn a_stamp_is_local_to_the_millisecond_with_its_offset_and_reads_back() {
        let m = Moment { ms: at("2026-10-15", 11, 3600).ms + 123, offset_s: 3600 };
        assert_eq!(m.stamp(), "2026-10-15T11:00:00.123+01:00");
        let line = format_line(m, "launch", "Pigeon 0.1.0\nsecond line");
        assert_eq!(line, "2026-10-15T11:00:00.123+01:00 launch Pigeon 0.1.0\\nsecond line");
        assert_eq!(parse_stamp(&line), Some(m.ms));
        let west = Moment { ms: m.ms, offset_s: -7 * 3600 };
        assert_eq!(west.stamp(), "2026-10-15T03:00:00.123-07:00");
        assert_eq!(parse_stamp(&west.stamp()), Some(m.ms));
        // Late evening west of Greenwich is still the local day.
        assert_eq!(at("2026-10-15", 23, -7 * 3600).day(), parse_date("2026-10-15").unwrap());
    }

    #[test]
    fn the_page_gets_eighty_characters_but_the_plan_is_kept_whole() {
        let long = "x".repeat(200);
        let out = sanitize(&json!({
            "message": long, "reply": "short",
            "plan": { "steps": [{ "skill": "sum", "input": { "text": long } }] },
            "nested": [{ "said": long }],
            "picture": "data:image/png;base64,AAAA",
            "file": "/Users/k/.airoplane-mode/seal.key",
            "n": 3
        }));
        assert_eq!(out["message"].as_str().unwrap().chars().count(), 81);
        assert!(out["message"].as_str().unwrap().ends_with('…'));
        assert_eq!(out["reply"], "short");
        assert_eq!(out["plan"]["steps"][0]["input"]["text"].as_str().unwrap().len(), 200);
        assert_eq!(out["nested"][0]["said"].as_str().unwrap().chars().count(), 81);
        assert_eq!(out["picture"], "[picture left out]");
        assert_eq!(out["file"], "[left out: ~/.airoplane-mode]");
        assert_eq!(out["n"], 3);
        // Even inside the plan, no picture and nothing from ~/.airoplane-mode.
        let p = sanitize(&json!({ "plan": { "a": "data:image/png;base64,AA", "b": "~/.airoplane-mode/x" } }));
        assert_eq!(p["plan"]["a"], "[picture left out]");
        assert_eq!(p["plan"]["b"], "[left out: ~/.airoplane-mode]");
        let shown = sanitize(&json!({ "sentence": "s".repeat(400), "message": "m".repeat(400) }));
        assert_eq!(shown["sentence"].as_str().unwrap().chars().count(), 301);
        assert_eq!(shown["message"].as_str().unwrap().chars().count(), 81);
        assert_eq!(first_chars("héllo", 3), "hél…");
        assert_eq!(page_kind("ask"), "ask");
        assert_eq!(page_kind("Ask\n"), "page");
    }

    #[test]
    fn a_line_never_passes_its_byte_limit() {
        let line = format_line(Moment::now(), "ask", &"é".repeat(LINE_BYTES));
        assert!(line.len() <= LINE_BYTES);
        assert!(line.ends_with('…'));
    }

    #[test]
    fn each_day_gets_its_own_file() {
        let dir = scratch("days");
        let mut w = Writer::new(dir.clone(), DAY_CAP);
        w.append(&format_line(at("2026-10-14", 23, 0), "a", "one")).unwrap();
        w.append(&format_line(at("2026-10-15", 1, 0), "a", "two")).unwrap();
        w.append(&format_line(at("2026-10-15", 2, 0), "a", "three")).unwrap();
        let read = |d: &str| std::fs::read_to_string(dir.join(format!("pigeon-{d}.log"))).unwrap();
        assert_eq!(read("2026-10-14").lines().count(), 1);
        assert_eq!(read("2026-10-15").lines().count(), 2);
        assert!(read("2026-10-15").ends_with("a three\n"));
    }

    #[test]
    fn a_day_past_the_cap_loses_its_oldest_lines_and_says_how_many() {
        let dir = scratch("cap");
        let mut w = Writer::new(dir.clone(), 4000);
        for i in 0..100 {
            w.append(&format_line(at("2026-10-15", 9, 0), "n", &format!("line {i:03} {}", "z".repeat(40)))).unwrap();
        }
        let text = std::fs::read_to_string(dir.join("pigeon-2026-10-15.log")).unwrap();
        assert!(text.len() as u64 <= 4000, "{} bytes", text.len());
        let first = text.lines().next().unwrap();
        assert!(first.contains("oldest lines of this day were dropped"), "{first}");
        assert!(text.ends_with(&format!("line 099 {}\n", "z".repeat(40))));
        // Lines kept are whole, in order, and the newest.
        let nums: Vec<u32> = text.lines().skip(1).map(|l| l.split("line ").nth(1).unwrap()[..3].parse().unwrap()).collect();
        assert!(nums.windows(2).all(|p| p[1] == p[0] + 1));
        let (_, dropped) = trim_text("a\nb\nc\nd\n", 4);
        assert_eq!(dropped, 2);
    }

    #[test]
    fn launch_deletes_days_older_than_thirty_and_nothing_else() {
        let dir = scratch("prune");
        let today = parse_date("2026-10-15").unwrap();
        for back in [0, 1, 29, 30, 31, 90] {
            std::fs::write(dir.join(file_name(today - back)), "x\n").unwrap();
        }
        std::fs::write(dir.join("notes.txt"), "keep").unwrap();
        assert_eq!(prune(&dir, today, KEEP_DAYS), 3);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
        left.sort();
        assert_eq!(left, ["notes.txt", "pigeon-2026-09-16.log", "pigeon-2026-10-14.log", "pigeon-2026-10-15.log"]);
    }

    #[test]
    fn a_full_queue_drops_and_counts_and_the_count_is_written() {
        let dir = scratch("queue");
        let (logger, rx, dropped) = Logger::unstarted(3);
        let m = at("2026-10-15", 10, 0);
        for i in 0..10 {
            logger.send(format_line(m, "ask", &format!("n{i}")));
        }
        assert_eq!(dropped.load(Ordering::Relaxed), 7);
        drop(logger);
        run(rx, &dropped, Writer::new(dir.clone(), DAY_CAP));
        // The count is stamped now, so it may land in today's file.
        let text: String = std::fs::read_dir(&dir).unwrap().map(|e| std::fs::read_to_string(e.unwrap().path()).unwrap()).collect();
        assert!(text.contains("7 lines were dropped: the queue was full"), "{text}");
        assert_eq!(text.matches(" ask n").count(), 3);
        assert_eq!(dropped.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn the_tail_is_the_last_hour_across_midnight() {
        let dir = scratch("tail");
        let mut w = Writer::new(dir.clone(), DAY_CAP);
        let now = Moment { ms: at("2026-10-15", 0, 0).ms + 20 * 60_000, offset_s: 0 };
        for (mins_ago, t) in [(90, "old"), (50, "yesterday-late"), (10, "today")] {
            w.append(&format_line(Moment { ms: now.ms - mins_ago * 60_000, offset_s: 0 }, "e", t)).unwrap();
        }
        let got: Vec<String> = tail(&dir, now, 60).iter().map(|l| l.rsplit(' ').next().unwrap().to_string()).collect();
        assert_eq!(got, ["yesterday-late", "today"]);
    }

    #[test]
    fn days_join_in_order_with_dividers_and_name_the_missing() {
        let dir = scratch("join");
        let d = |s| parse_date(s).unwrap();
        std::fs::write(dir.join(file_name(d("2026-10-13"))), "first\n").unwrap();
        std::fs::write(dir.join(file_name(d("2026-10-15"))), "third").unwrap();
        let out = join_days(&dir, d("2026-10-13"), d("2026-10-15"), "HEADER").unwrap();
        assert_eq!(
            out,
            "HEADER\n\n===== 2026-10-13 =====\nfirst\n===== 2026-10-14: no log for this day =====\n===== 2026-10-15 =====\nthird\n"
        );
        assert_eq!(range_file_name(d("2026-10-13"), d("2026-10-15")), "pigeon-logs-2026-10-13-2026-10-15.txt");
    }

    #[test]
    fn a_range_with_nothing_in_it_says_so() {
        let dir = scratch("empty");
        let d = |s| parse_date(s).unwrap();
        let out = join_days(&dir, d("2026-01-01"), d("2026-01-02"), "HEADER").unwrap();
        assert!(out.contains("===== 2026-01-01: no log for this day ====="));
        assert!(out.contains("No log files exist for 2026-01-01 to 2026-01-02"));
        assert!(join_days(&dir, d("2026-01-02"), d("2026-01-01"), "H").is_err());
        assert!(join_days(&dir, d("2024-01-01"), d("2026-01-01"), "H").is_err());
    }

    #[test]
    fn the_presets_end_today_and_count_it() {
        let today = parse_date("2026-10-15").unwrap();
        let d = |s| parse_date(s).unwrap();
        assert_eq!(range_days("today", None, None, today), Ok((today, today)));
        assert_eq!(range_days("7", None, None, today), Ok((d("2026-10-09"), today)));
        assert_eq!(range_days("30", None, None, today), Ok((d("2026-09-16"), today)));
        assert_eq!(range_days("custom", Some("2026-10-01"), Some("2026-10-03"), today), Ok((d("2026-10-01"), d("2026-10-03"))));
        assert!(range_days("custom", Some("2026-10-03"), Some("2026-10-01"), today).is_err());
        assert!(range_days("custom", None, Some("2026-10-01"), today).is_err());
        assert!(range_days("../etc", None, None, today).is_err());
    }

    #[test]
    fn diagnostics_too_long_are_refused_before_the_pasteboard() {
        assert!(diagnostics_copy("x".repeat(COPY_BYTES + 1)).is_err());
    }

    #[test]
    fn footprint_reads_on_this_mac() {
        if cfg!(target_os = "macos") {
            let mb = footprint_mb().expect("phys_footprint");
            assert!(mb > 0 && mb < 64 * 1024, "{mb} MB");
        }
    }
}

// ── what this Mac and this build are ─────────────────────────────────────

/// "macOS 26.0.1", or "macOS (unknown version)".
pub fn macos_version() -> String {
    static V: OnceLock<String> = OnceLock::new();
    V.get_or_init(|| {
        std::process::Command::new("/usr/sbin/sysctl")
            .args(["-n", "kern.osproductversion"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty())
            .map_or("macOS (unknown version)".into(), |v| format!("macOS {v}"))
    })
    .clone()
}

/// The model files Pigeon can see: its own folder (and projectors). Names
/// and sizes only.
pub fn models_found<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    let mb = |b: u64| format!("{} MB", b / (1024 * 1024));
    let parts: Vec<String> = crate::weights::own_dir(app)
        .map(|d| crate::modelstore::list_in(&d, |_| None))
        .unwrap_or_default()
        .into_iter()
        .filter(|s| s.kind != "training copy")
        .map(|s| format!("{} {}", s.path, mb(s.bytes)))
        .collect();
    if parts.is_empty() { "none".into() } else { parts.join(", ") }
}

/// Which Patch: "v10 bundled, nest 11 Pigeons, sealed by 5bce…", or why none.
pub fn patch_line<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    use tauri::Manager;
    match app.try_state::<crate::patch::PatchState>().and_then(|s| s.pack()) {
        Some(p) => format!(
            "v{} {}, {}, sealed by {}",
            p.version,
            if p.source == crate::patch::PackSource::Bundled { "bundled" } else { "imported" },
            if p.members.is_empty() { "no nest".to_string() } else { format!("nest of {} Pigeons", p.members.len()) },
            p.sealed_by
        ),
        None => "not ready".into(),
    }
}

/// The header Copy diagnostics and Save logs… put first.
pub fn header<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    format!(
        "App: Pigeon {} ({})\nPatch: {}\nEngine: {}\nMac: {}\nModels: {}\nMemory now: {}",
        app.package_info().version,
        crate::appmenu::COMMIT,
        patch_line(app),
        pigeon_engine::version(),
        macos_version(),
        models_found(app),
        memory_now()
    )
}

/// The launch line: everything in the header that is known before Patch is
/// chosen (his own line follows when he is).
pub fn launch<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    write(
        "launch",
        &format!(
            "Pigeon {} ({}) · {} · engine {} · models: {} · memory: {}",
            app.package_info().version,
            crate::appmenu::COMMIT,
            macos_version(),
            pigeon_engine::version(),
            models_found(app),
            memory_now()
        ),
    );
}

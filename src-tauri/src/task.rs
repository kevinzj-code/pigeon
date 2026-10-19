//! Task Pigeons: a model trained for one job, asked to do that job and
//! nothing else. The transcript tidier is the `tidier` Pigeon in Patch's nest
//! (D84), its instruction its own `system_prompt.txt`.
//!
//! This is a THIRD door, deliberately not either of the other two, and the
//! difference is the whole reason it is a separate file:
//!
//!   `llm_complete`  the router and the planner's asks: Lane A's Pigeons,
//!                   asked with an input and host values, under a grammar.
//!   `chat_complete` Lane B. The page supplies the MESSAGES, so a model may
//!                   write any prose a person asks it for. That is what the
//!                   lane is, and why it is fenced.
//!   `task_complete` this. The page supplies only TEXT and the name of a task
//!                   from a closed set. The instruction is a constant in this
//!                   file; the page cannot write it, vary it, or reach a model
//!                   with anything else. So this cannot become a second way to
//!                   make the shell produce arbitrary prose.
//!
//! What comes back is INPUT, not a reply — a repunctuated copy of text the
//! person already had. The page audits it (`auditRepair` in captions.js: a
//! faithful repair does not change one letter) and shows it beside the
//! original for the person to choose between. Nothing here reaches the
//! conversation on its own.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::engine::Engine;

const MAX_INPUT_CHARS: usize = 8_000;

/// The closed set. A task is a name the page may say and the Pigeon that does
/// it; the instruction is that Pigeon's own system prompt, not anything in the
/// request, which is what stops this being a general prose door.
struct Task {
    name: &'static str,
    /// The Pigeon in Patch's nest that does this task through the engine
    /// (D84), carrying the same instruction as its system prompt.
    pigeon: &'static str,
}

/// The tidier Pigeon's instruction, as trained (`model/transcript-data/
/// INSTRUCTION.txt`). Duplicated in src/captions-tidy.js for the dev path,
/// which asks a bare llama-server; a test asserts the two match.
#[cfg_attr(not(test), allow(dead_code))]
pub const TRANSCRIPT_INSTRUCTION: &str = "Repair this transcript. Put the sentence boundaries and capitals where they belong, restore the paragraph breaks, and repair a name the transcriber split. Change nothing else: do not add, remove, reorder or summarise any word, and leave every number exactly as it is. Reply with the repaired transcript and nothing else.";

const TASKS: &[Task] = &[Task {
    name: "transcript-repair",
    pigeon: "tidier",
}];

fn task_named(name: &str) -> Option<&'static Task> {
    TASKS.iter().find(|t| t.name == name)
}

#[derive(Deserialize)]
pub struct TaskRequest {
    /// A task name from the closed set above. Never an adapter, never a path.
    pub task: String,
    /// The text to work on. The only thing the page contributes.
    pub text: String,
    pub max_tokens: Option<u32>,
    /// A number the page chose for this piece of a longer text. With one,
    /// the repair is streamed as it grows: each `task-piece` event carries
    /// this number and the next characters, so a page asking several pieces
    /// at once can tell them apart. Without one, nothing is emitted.
    #[serde(default)]
    pub piece: Option<u64>,
}

/// What a `task-piece` event carries: the page's number for the piece and
/// the characters that just arrived, in order.
pub const PIECE_EVENT: &str = "task-piece";

#[derive(Serialize)]
pub struct TaskReply {
    pub text: String,
    pub ms: u64,
    pub tokens: u64,
    pub prompt_tokens: u64,
    /// The adapter actually worn, echoed back so the page can say what did the
    /// work rather than what was asked for.
    pub adapter: String,
    pub finish_reason: Option<String>,
}

/// Every task this build can run, so the page can offer one only when it is
/// there. A task whose adapter did not load is listed as not ready rather than
/// quietly answered from base weights — an adapter silently not worn is the
/// failure nobody can see.
#[derive(Serialize)]
pub struct TaskInfo {
    pub name: String,
    pub adapter: String,
    pub ready: bool,
}

#[tauri::command]
pub async fn tasks_list<R: tauri::Runtime>(app: AppHandle<R>) -> Result<Vec<TaskInfo>, String> {
    Ok(TASKS
        .iter()
        .map(|t| TaskInfo { name: t.name.into(), adapter: t.pigeon.into(), ready: crate::patch::pigeon_source(&app, t.pigeon).is_some() })
        .collect())
}

#[tauri::command]
pub async fn task_complete<R: tauri::Runtime>(
    app: AppHandle<R>,
    req: TaskRequest,
) -> Result<TaskReply, String> {
    let Some(task) = task_named(&req.task) else {
        return Err(format!("no such task: \"{}\"", req.task));
    };
    if req.text.trim().is_empty() {
        return Err("there was nothing to work on".into());
    }
    /* A cap here as well as in the page. The page chunks before it calls, so
       anything this long has bypassed that, and a 200,000-character paste
       should be refused rather than spend four minutes filling the context. */
    if req.text.chars().count() > MAX_INPUT_CHARS {
        return Err(format!(
            "that is too long for one pass: {} characters, and the limit is {MAX_INPUT_CHARS}",
            req.text.chars().count()
        ));
    }

    app.state::<Engine>().touch();
    task_in_engine(&app, task, &req).await
}

/// The task's Pigeon from Patch's nest, through the engine: the same text,
/// greedy, with the page's budget (capped as the server's was).
async fn task_in_engine<R: tauri::Runtime>(app: &AppHandle<R>, task: &Task, req: &TaskRequest) -> Result<TaskReply, String> {
    let started = std::time::Instant::now();
    let request = serde_json::json!({
        "input": req.text,
        "options": { "stream": req.piece.is_some(), "max_tokens": req.max_tokens.unwrap_or(1024).min(2048) },
    });
    let ev = crate::inprocess::ask_patch_with(app, task.pigeon, request, Vec::new(), crate::inprocess::emit_pieces(app, PIECE_EVENT, req.piece)).await?;
    let stat = |k: &str| ev["stats"][k].as_u64().unwrap_or(0);
    Ok(TaskReply {
        text: ev["raw"].as_str().unwrap_or_default().to_string(),
        ms: started.elapsed().as_millis() as u64,
        tokens: stat("answer_tokens"),
        prompt_tokens: stat("prompt_tokens"),
        adapter: task.pigeon.to_string(),
        // The server's words for it, which the page's audit reads.
        finish_reason: Some(if ev["stopped"] == "max_tokens" { "length" } else { "stop" }.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The page may only name a task from the set. Anything else is refused
    /// before a model is reached, which is what makes the closed set closed.
    #[test]
    fn only_the_named_tasks_exist() {
        assert!(task_named("transcript-repair").is_some());
        for made_up in ["", "chat", "transcript-clean", "anything", "../transcript-repair"] {
            assert!(task_named(made_up).is_none(), "{made_up} resolved to a task");
        }
    }

    /// Every task names one of the Pigeons Patch's nest carries for it.
    #[test]
    fn every_task_is_a_plain_pigeon_id() {
        for t in TASKS {
            assert!(pigeon_core::plain_id(t.pigeon), "{}", t.pigeon);
        }
    }

    /// An instruction the page could rewrite would make this a prose door.
    #[test]
    fn the_instruction_is_a_constant_and_says_what_it_forbids() {
        assert!(TRANSCRIPT_INSTRUCTION.contains("do not add, remove, reorder or summarise"));
        assert!(TRANSCRIPT_INSTRUCTION.contains("leave every number exactly as it is"));
    }
}

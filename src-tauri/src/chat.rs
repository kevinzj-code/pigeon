//! Lane B's seam: the one command in this shell that lets a model write a
//! sentence a person reads.
//!
//! Everything else here is built so that cannot happen. `llm_complete` answers
//! the router and the planner, which pick from a menu under a grammar; the
//! words in a Lane A reply come from a template around values a tested
//! function produced. This command is the exception, and it is a separate
//! command rather than a flag on that one so the difference is visible in the
//! handler list, in the capability file, and here.
//!
//! What keeps it apart from Lane A: it asks different Pigeons. Lane A's are
//! named by `llm_complete` from a closed list and answer under a grammar;
//! this one asks Pen or Peek (base Pigeons in Patch's nest, D83) or a voice
//! the person imported, each from its own file, which says what it is sent:
//! its system prompt (D3), its temperature (D4) and how much history (D17).
//! Lane B is allowed to vary; that is what it is for.
//!
//! The page names a PERSONA — an id it was told about by `personas_list` —
//! and never a path. Naming one that cannot be asked is an error rather than
//! a silent answer from base weights, because a persona quietly not being
//! worn is exactly the failure a person cannot see.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::engine::Engine;
use crate::weights::PersonaInfo;
use crate::ChatMessage;

/// Long enough for a paragraph on a slow machine, short enough that a wedged
/// server is reported rather than waited on forever.

#[derive(Deserialize)]
pub struct ChatRequest {
    pub messages: Vec<ChatMessage>,
    /// A persona's id, as `personas_list` reported it. None is base weights.
    pub persona: Option<String>,
    pub max_tokens: Option<u32>,
    /// Write on the picture model instead (Peek): no persona, and every
    /// picture Pigeon loaded beside it turned off.
    #[serde(default)]
    pub peek: bool,
    /// One picture for Peek, as a `data:image/…;base64,` URL, put in front of
    /// the newest message. Nothing else can be handed one here.
    pub image: Option<String>,
    /// Pen asked again without figures (the page added NO_AMOUNTS to his
    /// system message). Through the engine that is its own Pigeon.
    #[serde(default)]
    pub no_amounts: bool,
    /// A number the page chose for this reply. With one, the reply is
    /// streamed as it is written: each `chat-piece` event carries this number
    /// and the next characters. The page shows a sentence once it is whole
    /// and has passed its own figure guard; the final reply still comes back
    /// whole below, checked whole. Without one, nothing is emitted.
    #[serde(default)]
    pub piece: Option<u64>,
}

/// What a `chat-piece` event carries: the page's number and the characters
/// that just arrived, in order.
pub const PIECE_EVENT: &str = "chat-piece";

#[derive(Serialize)]
pub struct ChatReply {
    pub text: String,
    pub ms: u64,
    pub tokens: u64,
    pub prompt_tokens: u64,
    /// The persona actually worn, echoed back so the transcript records what
    /// wrote the words rather than what was asked for.
    pub persona: Option<String>,
    /// Why the model stopped: "stop" or "length". A reply cut off mid-sentence
    /// is a different thing from a finished one and the page says so.
    pub finish_reason: Option<String>,
}

#[cfg(test)]
mod shape_tests {
    use super::*;
    fn m(role: &str, content: &str) -> ChatMessage { ChatMessage { role: role.into(), content: content.into() } }

    #[test]
    fn a_turn_whose_reply_was_dropped_goes_as_the_words_alone() {
        // E19: Pen's turn the figure guard dropped is a person's message with no reply after it.
        let msgs = vec![m("system", "rules"), m("user", "what is 3 + 4"), m("user", "fair enough, tell me a joke"), m("assistant", "Why did…"), m("user", "another")];
        let (input, history) = conversation(&msgs).unwrap();
        assert_eq!(input, "another");
        assert_eq!(history, vec![
            serde_json::json!({ "user": "what is 3 + 4", "pigeon": null }),
            serde_json::json!({ "user": "fair enough, tell me a joke", "pigeon": "Why did…" }),
        ]);
        assert!(conversation(&[m("user", "a"), m("assistant", "b")]).is_err(), "the newest message must be the person's");
    }

}

#[tauri::command]
pub async fn chat_complete<R: tauri::Runtime>(
    app: AppHandle<R>,
    req: ChatRequest,
) -> Result<ChatReply, String> {
    app.state::<Engine>().touch();
    if req.image.is_some() && !req.peek {
        return Err("the chat model reads text only — a picture goes to Peek or a picture Pigeon".into());
    }
    /* Pen and Peek are Pigeons in Patch's nest (D83, D84): their files say
       what they are sent. */
    let Some(id) = req.persona.as_deref() else {
        return plain_in_engine(&app, req).await;
    };
    if req.peek {
        return Err("Peek wears no Pigeon".into());
    }
    /* A voice is asked from the file this app kept for it, which sends it
       what its file says (D3, D4, D17). One dropped into the folder by hand,
       with no file, cannot be asked. */
    let kept = crate::inprocess::wanted(&app, id)
        .ok_or_else(|| format!("\"{id}\" came without its .pigeon file, so it cannot be asked — add it again from its file"))?;
    chat_in_process(&app, req, &kept).await
}

/// A voice through pigeon-engine. Its file decides what it is sent: its own
/// `system_prompt.txt` (D3), its own temperature (D4) and as much of the
/// conversation as its `history` declares (D17), the engine applying all
/// three. So the page's own system message, temperature, length and seed,
/// and the measured shape, are not used here; the file's are.
async fn chat_in_process<R: tauri::Runtime>(app: &AppHandle<R>, req: ChatRequest, kept: &std::path::Path) -> Result<ChatReply, String> {
    let (input, history) = conversation(&req.messages)?;
    let request = serde_json::json!({ "input": input, "history": history, "options": { "stream": req.piece.is_some() } });
    let ev = crate::inprocess::ask_with(app, kept, request, Vec::new(), crate::inprocess::emit_pieces(app, PIECE_EVENT, req.piece)).await?;
    Ok(reply_of(&ev, req.persona))
}

/// The page's messages as the engine takes them: the newest (the person's)
/// as the input, and every earlier exchange as a history turn. A person's
/// message with no reply after it, because the figure guard dropped the
/// reply or none came, is a turn with `pigeon: null` (E19), so the Pigeon is
/// sent the conversation exactly as the server was. System messages are the
/// file's business, not the page's, and are left out.
pub fn conversation(messages: &[ChatMessage]) -> Result<(String, Vec<serde_json::Value>), String> {
    let mut said: Vec<&ChatMessage> = messages.iter().filter(|m| m.role != "system").collect();
    let newest = said.pop().filter(|m| m.role == "user").ok_or("the newest message is not the person's")?;
    let mut history = Vec::new();
    let mut i = 0;
    while i < said.len() {
        match (said[i].role.as_str(), said.get(i + 1).map(|m| m.role.as_str())) {
            ("user", Some("assistant")) => {
                history.push(serde_json::json!({ "user": said[i].content, "pigeon": said[i + 1].content }));
                i += 2;
            }
            ("user", _) => {
                history.push(serde_json::json!({ "user": said[i].content, "pigeon": null }));
                i += 1;
            }
            _ => i += 1,
        }
    }
    Ok((newest.content.clone(), history))
}

/// The longer side a picture is brought down to before Peek sees it, in
/// pixels. Qwen3-VL makes one picture token of every 32 × 32 pixels, so a
/// Retina screenshot at full size is several times this many tokens before
/// the projector's own limit shrinks it, and each token costs twice: once in
/// the vision encoder, once in the prefill.
const PEEK_MAX_SIDE: usize = 1024;

/// Pen or Peek, through the engine: `pen` (or `pen-no-figures` when the page
/// asks again without figures), `peek` with a picture, `peek-words` without.
async fn plain_in_engine<R: tauri::Runtime>(app: &AppHandle<R>, req: ChatRequest) -> Result<ChatReply, String> {
    let id = match (req.peek, req.image.is_some(), req.no_amounts) {
        (true, true, _) => "peek",
        (true, false, _) => "peek-words",
        (false, _, true) => "pen-no-figures",
        (false, _, false) => "pen",
    };
    let (input, history) = conversation(&req.messages)?;
    let mut request = serde_json::json!({ "input": input, "history": history, "options": { "stream": req.piece.is_some() } });
    let mut attachments = Vec::new();
    if let Some(url) = req.image.as_deref() {
        let bytes = crate::inprocess::picture_bytes(crate::pigeon::picture_url(url)?)?;
        /* Peek reads a picture at the projector's own size, which is smaller
           than a screenshot of this Mac; shrunk here, the vision encoder and
           the picture's prefill have fewer picture tokens to do. The log's
           `prompt N tokens` line for peek says how many. */
        let bytes = pigeon_engine::fit_picture(&bytes, PEEK_MAX_SIDE)?.unwrap_or(bytes);
        attachments.push(bytes);
        request["picture"] = serde_json::json!({ "attachment": 0 });
    }
    if let Some(n) = req.max_tokens {
        request["options"]["max_tokens"] = n.into();
    }
    let ev = crate::inprocess::ask_patch_with(app, id, request, attachments, crate::inprocess::emit_pieces(app, PIECE_EVENT, req.piece)).await?;
    Ok(reply_of(&ev, None))
}

fn reply_of(ev: &serde_json::Value, persona: Option<String>) -> ChatReply {
    let stat = |k: &str| ev["stats"][k].as_u64().unwrap_or(0);
    ChatReply {
        text: ev["raw"].as_str().unwrap_or_default().to_string(),
        ms: stat("total_ms"),
        tokens: stat("answer_tokens"),
        prompt_tokens: stat("prompt_tokens"),
        persona,
        finish_reason: ev["stopped"].as_str().map(|s| match s {
            "end" => "stop".to_string(),
            "max_tokens" => "length".to_string(),
            other => other.to_string(),
        }),
    }
}

/// Every Pigeon installed on this machine, and whether it can be asked: the
/// engine asks one from the file this app kept for it.
#[tauri::command]
pub async fn personas_list<R: tauri::Runtime>(app: AppHandle<R>) -> Result<Vec<PersonaInfo>, String> {
    Ok(crate::weights::personas(&app)
        .into_iter()
        .map(|p| PersonaInfo {
            shape: crate::weights::measured_shape(&p.contract),
            icon: p.path.parent().and_then(|dir| crate::weights::icon_data_url(dir, &p.id)),
            /* One whose file this app kept is loaded by the engine when it is
               asked; one dropped in by hand, with no file, cannot be. */
            loaded: crate::inprocess::wanted(&app, &p.id).is_some(),
            /* Mapped, so only its directory and report.json are read. */
            report: crate::inprocess::wanted(&app, &p.id)
                .and_then(|kept| pigeon_core::blob::Blob::open(&kept).ok())
                .map(|b| crate::weights::report_facts(&b)),
            vision: p.contract.projector.is_some(),
            base: p.contract.projector.as_ref().and(p.contract.base_file.clone()),
            presses: p.path.parent().and_then(|dir| crate::pigeon::presses_in(dir, &p.id)),
            id: p.id,
            name: p.name,
            bytes: p.bytes,
            kind: p.contract.kind,
            max_tokens: p.contract.max_tokens,
            output_type: p.contract.output_type,
            labels: p.contract.labels,
            skill: p.contract.skill,
            retrieval: p.contract.retrieval,
            card: p.contract.card,
            inputs: p.contract.inputs,
            notes: p.contract.notes,
            base_only: p.contract.base_only,
        })
        .collect())
}

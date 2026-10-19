//! The embedding model `hybrid-v1` retrieval asks with (§9.4): the question,
//! with the file's query prefix, as one unit-length vector.

use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::llama::{Batch, Context, ContextParams, Model};

const CELLS: u32 = 2048;

pub struct Embedder {
    pub sha256: String,
    pub file: String,
    pub bytes: u64,
    ctx: Mutex<Context>,
}

impl Embedder {
    /// Loaded the way the app's embedding server ran it: mean pooling, 2048
    /// tokens, the whole input in one step.
    pub fn load(path: &Path, sha256: &str) -> Result<Embedder, String> {
        let model = Arc::new(Model::load(path)?);
        let ctx = Context::new(&model, &ContextParams { n_ctx: CELLS, n_batch: CELLS, n_seq_max: 1, kv_unified: true, embeddings: true, n_ubatch: Some(CELLS) })?;
        Ok(Embedder {
            sha256: sha256.to_string(),
            file: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            bytes: model.size() + ctx.allocated(),
            ctx: Mutex::new(ctx),
        })
    }

    /// `prefix + text`, embedded and scaled to unit length.
    pub fn embed(&self, prefix: &str, text: &str) -> Result<Vec<f32>, String> {
        let mut ctx = self.ctx.lock().map_err(|_| "the embedder's lock is poisoned")?;
        let tokens = ctx.model().tokenize(&format!("{prefix}{}", text.trim()), true)?;
        if tokens.len() > CELLS as usize {
            return Err(format!("the question is {} tokens, and the embedding model reads at most {CELLS}", tokens.len()));
        }
        ctx.clear();
        let mut batch = Batch::new(tokens.len().max(1));
        for (i, &t) in tokens.iter().enumerate() {
            batch.add(t, i as i32, 0, true)?;
        }
        ctx.decode(&batch)?;
        let v = ctx.embedding(0).ok_or("the embedding model gave no vector")?;
        let n = v.iter().map(|x| (*x as f64) * (*x as f64)).sum::<f64>().sqrt();
        let n = if n > 0.0 { n as f32 } else { 1.0 };
        Ok(v.into_iter().map(|x| x / n).collect())
    }
}

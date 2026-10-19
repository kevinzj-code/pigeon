//! The engine embeds `hybrid-v1` questions as the Pigeon app's embedding
//! server does, so retrieval picks the same sections in both. Starts that
//! server itself, with the app's own arguments, and skips unless all of these
//! are set:
//!
//!   PIGEON_MODELS_DIR       holds nomic-embed-text-v1.5.Q8_0.gguf
//!   PIGEON_LLAMA_SERVER     the app's llama-server binary
//!   PIGEON_QWEN3VL_PIGEONS  holds pat-v2.pigeon and pat---local-draft.pigeon

use std::path::PathBuf;
use std::process::{Command, Stdio};

use pigeon_core::{material, zip_store};
use serde_json::{json, Value};

const PORT: u16 = 18_631;

struct Server(std::process::Child);
impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn server_vector(text: &str) -> Vec<f32> {
    let out = Command::new("curl")
        .args(["-s", "-H", "Content-Type: application/json", "-d", &json!({ "input": text }).to_string(), &format!("http://127.0.0.1:{PORT}/v1/embeddings")])
        .output()
        .unwrap();
    let v: Value = serde_json::from_slice(&out.stdout).unwrap();
    let raw: Vec<f32> = v["data"][0]["embedding"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap() as f32).collect();
    let n = raw.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt() as f32;
    raw.into_iter().map(|x| x / n).collect()
}

#[test]
fn engine_and_app_server_embed_alike_and_pick_the_same_sections() {
    let var = |k: &str| std::env::var_os(k).map(PathBuf::from);
    let (Some(models), Some(server), Some(pigeons)) = (var("PIGEON_MODELS_DIR"), var("PIGEON_LLAMA_SERVER"), var("PIGEON_QWEN3VL_PIGEONS")) else {
        eprintln!("skipped: set PIGEON_MODELS_DIR, PIGEON_LLAMA_SERVER and PIGEON_QWEN3VL_PIGEONS");
        return;
    };
    let model = models.join("nomic-embed-text-v1.5.Q8_0.gguf");
    let _server = Server(
        Command::new(server)
            .arg("-m").arg(&model)
            .args(["--embedding", "--pooling", "mean", "-c", "2048", "-b", "2048", "-ub", "2048", "--port", &PORT.to_string(), "--host", "127.0.0.1", "-ngl", "999"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    for _ in 0..240 {
        let up = Command::new("curl").args(["-s", "-o", "/dev/null", "-w", "%{http_code}", &format!("http://127.0.0.1:{PORT}/health")]).output().unwrap();
        if up.stdout == b"200" {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    let (mut questions, mut same_pick, mut worst) = (0, 0, 1.0f64);
    for file in ["pat-v2.pigeon", "pat---local-draft.pigeon"] {
        let bytes = std::fs::read(pigeons.join(file)).unwrap();
        let entries = zip_store::list_entries(&bytes).unwrap();
        let get = |n: &str| zip_store::get(&entries, &bytes, n).unwrap().unwrap();
        let index: material::ChunkIndex = serde_json::from_slice(get("material/chunks.json")).unwrap();
        let emb = material::Embeddings::parse(get(material::EMBEDDINGS_FILE)).unwrap();
        let report: Value = serde_json::from_slice(get("report.json")).unwrap();
        for row in report["check_ride"]["rows"].as_array().unwrap() {
            let q = row["question"].as_str().unwrap();
            let q = material::split_carried(&index, q).map_or(q, |(_, rest)| rest);
            let mine = pigeon_engine::embed_question(&model, &emb.model.query_prefix, q).unwrap();
            let theirs = server_vector(&format!("{}{}", emb.model.query_prefix, q.trim()));
            let cos: f64 = mine.iter().zip(&theirs).map(|(a, b)| (*a as f64) * (*b as f64)).sum();
            worst = worst.min(cos);
            let pick = |v: &[f32]| material::find(&index, "hybrid-v1", q, Some((&emb, v))).unwrap().iter().map(|c| c.ordinal).collect::<Vec<_>>();
            questions += 1;
            same_pick += usize::from(pick(&mine) == pick(&theirs));
        }
    }
    eprintln!("{questions} questions: lowest cosine between the two vectors {worst:.6}; same sections picked {same_pick}/{questions}");
    assert!(worst > 0.999, "the engine's question vectors are not the server's");
    assert_eq!(same_pick, questions);
}

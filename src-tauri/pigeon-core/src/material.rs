//! `kind: "grounded"` — a Pigeon that answers from material it carries
//! (Flight School's `PIGEON-FORMAT.md` §8).
//!
//! The retrieval and the citation check are ported from Flight School's
//! `src-tauri/src/chunker.rs`, and must stay byte-for-byte equivalent to it:
//! the adapter was trained on sections picked by that search and rendered by
//! that `material_block`, and a different search answers from the wrong
//! sections in a way that reads exactly like the right ones.
//!
//! Only reading is ported. Chopping documents into sections is Flight
//! School's job; a `.pigeon` arrives with `material/chunks.json` already made.

use serde::{Deserialize, Serialize};

pub const MATERIAL_SLOT: &str = "{material}";
pub const INPUT_SLOT: &str = "{input}";

/// Every retrieval method this app performs. A method not in this list is a
/// refusal by name at import — never a fallback to one that is (§8.1).
pub const RETRIEVALS: [&str; 4] = ["whole", "keyword-overlap-v1", "keyword-overlap-v2", "hybrid-v1"];

/// One section, as `material/chunks.json` carries it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct Chunk {
    pub ordinal: u32,
    #[serde(default)]
    pub file: String,
    #[serde(default)]
    pub title: String,
    pub text: String,
    #[serde(default)]
    pub est_tokens: u32,
}

/// `material/chunks.json` — the serialised form of Flight School's `ChunkIndex`.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct ChunkIndex {
    pub chunks: Vec<Chunk>,
    #[serde(default)]
    pub total_est_tokens: u32,
}

/// Lowercased `title text` per chunk, in index order.
pub fn haystacks(index: &ChunkIndex) -> Vec<String> {
    index
        .chunks
        .iter()
        .map(|c| {
            let mut h = String::with_capacity(c.title.len() + 1 + c.text.len());
            h.push_str(&c.title.to_lowercase());
            h.push(' ');
            h.push_str(&c.text.to_lowercase());
            h
        })
        .collect()
}

/// `keyword-overlap-v1`: words of four or more characters, each worth its
/// length when a section contains it, the first best score wins, and below
/// the floor the answer is no section at all.
pub fn best_chunk_for_in<'a>(index: &'a ChunkIndex, hay: &[String], question: &str) -> Option<&'a Chunk> {
    let words: Vec<String> = question
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() >= 4)
        .map(str::to_string)
        .collect();
    if words.is_empty() {
        return None;
    }
    let mut best: Option<(&Chunk, u32)> = None;
    for (chunk, hay) in index.chunks.iter().zip(hay) {
        let score: u32 = words.iter().map(|w| if hay.contains(w.as_str()) { w.len() as u32 } else { 0 }).sum();
        if score > best.map(|(_, s)| s).unwrap_or(0) {
            best = Some((chunk, score));
        }
    }
    // The floor: at least two matched medium words' worth of signal.
    best.filter(|(_, s)| *s >= 9).map(|(c, _)| c)
}

// ---------------------------------------------------------------------------
// keyword-overlap-v2 — a byte-for-byte port of Flight School's
// `chunker.rs::best_chunk_v2`, the reference definition. The two must agree,
// because the section this picks is the section the model answers from, and
// a different pick reads exactly like the right one.
//
// Measured on the Constitution Reader (docs/PIGEON-GROUNDED-BRIEF.md): v1
// found the right section for 76 of 176 questions, because "President",
// "Congress" and "State" are everywhere and the longest section wins. v2 is
// BM25 (k1 1.2, b 0.75) over stemmed words of three letters or more with a
// stoplist, an ordinal word ("fifteenth") read as the numeral its heading
// carries ("xv"), a bonus for a word in the section's title, and a bonus for
// a two-word phrase the question and the section share. 117 of 176. The base
// model's own embeddings, tried the same day, found 8 — so this stays lexical.

const STOP: [&str; 46] = ["the", "and", "for", "that", "with", "this", "shall", "from", "into", "upon", "than", "them", "they",
    "their", "there", "which", "what", "who", "whom", "when", "where", "how", "does", "did", "have", "has", "had", "been",
    "being", "are", "was", "were", "not", "nor", "but", "any", "all", "such", "may", "can", "each", "one", "two", "under",
    "over", "other"];
const STOP_TAIL: [&str; 4] = ["out", "its", "his", "her"];
const ORDINALS: [&str; 20] = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth",
    "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth", "twentieth"];
const V2_K1: f64 = 1.2;
const V2_B: f64 = 0.75;
const V2_TITLE_BONUS: f64 = 2.0;
const V2_PHRASE_BONUS: f64 = 2.0;
const V2_FLOOR: f64 = 3.0;

fn roman(n: u32) -> String {
    let mut n = n;
    let mut out = String::new();
    for (v, s) in [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")] {
        while n >= v { out.push_str(s); n -= v; }
    }
    out
}

fn ordinal_number(w: &str) -> Option<u32> {
    if let Some(i) = ORDINALS.iter().position(|o| *o == w) { return Some(i as u32 + 1); }
    let rest = w.strip_prefix("twenty")?;
    let rest = rest.strip_prefix('-').unwrap_or(rest);
    ORDINALS.iter().take(7).position(|o| *o == rest).map(|i| 21 + i as u32)
}

fn stem(w: &str) -> String {
    if w.len() > 4 && w.ends_with("ies") { return format!("{}y", &w[..w.len() - 3]); }
    if w.len() > 3 && w.ends_with('s') && !w.ends_with("ss") { return w[..w.len() - 1].to_string(); }
    w.to_string()
}

/// The words v2 scores: lowercased, split on anything but letters, digits and
/// hyphens; an ordinal word becomes the numeral a heading would carry;
/// hyphens are dropped; stopwords and words under three letters go.
pub fn v2_tokens(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    for raw in lower.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')) {
        if raw.is_empty() { continue; }
        let joined: String = raw.chars().filter(|c| *c != '-').collect();
        if let Some(n) = ordinal_number(raw).or_else(|| ordinal_number(&joined)) { out.push(roman(n)); continue; }
        if joined.len() >= 3 && !STOP.contains(&joined.as_str()) && !STOP_TAIL.contains(&joined.as_str()) {
            out.push(stem(&joined));
        }
    }
    out
}

struct V2Doc {
    tf: std::collections::HashMap<String, u32>,
    len: usize,
    title: std::collections::HashSet<String>,
    bigrams: std::collections::HashSet<(String, String)>,
}

fn v2_doc(chunk: &Chunk) -> V2Doc {
    let words = v2_tokens(&format!("{} {}", chunk.title, chunk.text));
    let mut tf = std::collections::HashMap::new();
    for w in &words { *tf.entry(w.clone()).or_insert(0) += 1; }
    let bigrams = words.windows(2).map(|p| (p[0].clone(), p[1].clone())).collect();
    V2Doc { tf, len: words.len(), title: v2_tokens(&chunk.title).into_iter().collect(), bigrams }
}

/// `keyword-overlap-v2`: the one best section for a question, or none when
/// the best score is under the floor. Ties go to the earlier section.
pub fn best_chunk_v2<'a>(index: &'a ChunkIndex, question: &str) -> Option<&'a Chunk> {
    let n = index.chunks.len();
    if n == 0 { return None; }
    let docs: Vec<V2Doc> = index.chunks.iter().map(v2_doc).collect();
    let avg = docs.iter().map(|d| d.len).sum::<usize>() as f64 / n as f64;
    let mut df: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    for d in &docs { for w in d.tf.keys() { *df.entry(w.as_str()).or_insert(0) += 1; } }
    let idf = |w: &str| -> f64 { let f = *df.get(w).unwrap_or(&0) as f64; (1.0 + (n as f64 - f + 0.5) / (f + 0.5)).ln() };
    let q = v2_tokens(question);
    let mut qset: Vec<&str> = Vec::new();
    for w in &q { if !qset.contains(&w.as_str()) { qset.push(w); } }
    let mut qbi: Vec<(&str, &str)> = Vec::new();
    for p in q.windows(2) { let b = (p[0].as_str(), p[1].as_str()); if !qbi.contains(&b) { qbi.push(b); } }
    let mut best: Option<(usize, f64)> = None;
    for (i, d) in docs.iter().enumerate() {
        let mut s = 0.0;
        for w in &qset {
            let f = *d.tf.get(*w).unwrap_or(&0) as f64;
            if f > 0.0 {
                s += idf(w) * f * (V2_K1 + 1.0) / (f + V2_K1 * (1.0 - V2_B + V2_B * d.len as f64 / avg));
                if d.title.contains(*w) { s += V2_TITLE_BONUS * idf(w); }
            }
        }
        s += V2_PHRASE_BONUS * qbi.iter().filter(|(a, b)| d.bigrams.contains(&(a.to_string(), b.to_string()))).count() as f64;
        if best.map(|(_, b)| s > b).unwrap_or(true) { best = Some((i, s)); }
    }
    best.filter(|(_, s)| *s >= V2_FLOOR).map(|(i, _)| &index.chunks[i])
}

/// Where in a shown section the answer came from, as UTF-16 offsets (what the
/// page's strings count in). `at` is the sentence sharing the most of the
/// answer's words; `also` is a second one when the answer joins two clauses
/// and that one carries at least `ALSO_FLOOR` words the first does not. `hits`
/// is how many of the answer's words `at` shares, so a caller holding several
/// sections can say which one the answer came from.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Support {
    pub at: (usize, usize),
    pub also: Option<(usize, usize)>,
    pub hits: usize,
}

/// Fewer than this many new words is a shared "president" and "vote", not a
/// second clause the answer came from — a wrong mark is worse than a missing
/// one.
const ALSO_FLOOR: usize = 3;

const UNITS: [&str; 20] = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
    "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS: [&str; 10] = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/// The words a supporting sentence is matched on. Retrieval's words, with two
/// differences that only matter for finding the sentence: a hyphenated word
/// counts as its parts ("thirty-five" is the "thirty five" a text writes), and
/// a number under 100 counts as its words ("35" is "thirty five"). An ordinal
/// stays whole ("twenty-first" is still xxi). Retrieval itself keeps
/// `v2_tokens`, which has to match what the Pigeon was trained on.
fn support_tokens(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    let mut out = Vec::new();
    let keep = |w: &str, out: &mut Vec<String>| {
        if let Some(n) = ordinal_number(w) { out.push(roman(n)); return; }
        if w.len() >= 3 && !STOP.contains(&w) && !STOP_TAIL.contains(&w) { out.push(stem(w)); }
    };
    for raw in lower.split(|c: char| !(c.is_ascii_alphanumeric() || c == '-')) {
        if raw.is_empty() { continue; }
        let joined: String = raw.chars().filter(|c| *c != '-').collect();
        if let Some(n) = ordinal_number(raw).or_else(|| ordinal_number(&joined)) { out.push(roman(n)); continue; }
        for part in raw.split('-').filter(|p| !p.is_empty()) {
            match part.parse::<usize>() {
                Ok(n) if part.len() <= 2 && n < 20 => keep(UNITS[n], &mut out),
                Ok(n) if part.len() <= 2 => {
                    keep(TENS[n / 10], &mut out);
                    if n % 10 != 0 { keep(UNITS[n % 10], &mut out); }
                }
                _ => keep(part, &mut out),
            }
        }
    }
    out
}

/// Where in a shown section the answer came from, or None when nothing shares
/// enough. Deterministic and cheap: the answer's words (its own `[§n]`
/// citations left out) against each sentence's. The sentence sharing the most
/// wins; on a tie, the one whose shared words are rarer in this section — a
/// sentence that shares "thirty" and "five" says more than one that shares
/// "President", which half the section does. A sentence ends at `.`, `;`, `!`
/// or `?` followed by a space, or at a paragraph break, so a clause of a long
/// constitutional sentence can be marked on its own.
pub fn support_scored(section: &str, answer: &str) -> Option<Support> {
    let (at, also, hits) = support_bytes(section, answer)?;
    let units = |(a, b): (usize, usize)| (section[..a].encode_utf16().count(), section[..b].encode_utf16().count());
    Some(Support { at: units(at), also: also.map(units), hits })
}

/// `support_scored` in byte ranges of `section`: (the sentence, a second
/// clause's sentence, shared-word count).
#[allow(clippy::type_complexity)]
fn support_bytes(section: &str, answer: &str) -> Option<((usize, usize), Option<(usize, usize)>, usize)> {
    let mut want: Vec<String> = Vec::new();
    for w in support_tokens(&strip_citations(answer)) { if !want.contains(&w) { want.push(w); } }
    if want.is_empty() { return None; }
    let floor = if want.len() <= 2 { 1 } else { 2 };
    let spans = sentences(section);
    let words: Vec<std::collections::HashSet<String>> =
        spans.iter().map(|(a, b)| support_tokens(&section[*a..*b]).into_iter().collect()).collect();
    let n = words.len() as f64;
    let rarity = |w: &String| -> f64 {
        let f = words.iter().filter(|s| s.contains(w)).count() as f64;
        (1.0 + (n - f + 0.5) / (f + 0.5)).ln()
    };
    let score = |i: usize, among: &[&String]| -> (usize, f64) {
        let shared: Vec<&&String> = among.iter().filter(|w| words[i].contains(**w)).collect();
        (shared.len(), shared.iter().map(|w| rarity(w)).sum())
    };
    let better = |a: (usize, f64), b: Option<(usize, (usize, f64))>| b.map(|(_, b)| a.0 > b.0 || (a.0 == b.0 && a.1 > b.1)).unwrap_or(true);
    let all: Vec<&String> = want.iter().collect();
    let mut best: Option<(usize, (usize, f64))> = None;
    for i in 0..spans.len() {
        let s = score(i, &all);
        if s.0 >= floor && better(s, best) { best = Some((i, s)); }
    }
    let (first, (hits, _)) = best?;
    let left: Vec<&String> = want.iter().filter(|w| !words[first].contains(*w)).collect();
    let mut second: Option<(usize, (usize, f64))> = None;
    for i in (0..spans.len()).filter(|i| *i != first) {
        let s = score(i, &left);
        if s.0 >= ALSO_FLOOR && better(s, second) { second = Some((i, s)); }
    }
    Some((spans[first], second.map(|(i, _)| spans[i]), hits))
}

/// Whether two answers to one question came from the same place in the
/// section they were shown: the check for a grounded Pigeon's carried
/// examples, where the words of a right answer may differ and its source may
/// not. Same when the live answer cites no section it was not shown, cites
/// the shown one whenever the expected answer does, and its supporting
/// sentence is the expected one's (either's second clause counts too). Two
/// answers that both decline are the same; one that declines is not.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct SourceMatch {
    pub same: bool,
    /// The sentence alone, citation aside (Flight School compares an
    /// untrained model on this; it never learned to cite).
    pub sentence: bool,
    /// The sentence each answer came from, for a person to compare.
    pub expected: Option<String>,
    pub got: Option<String>,
}

pub fn same_source(ordinal: u32, text: &str, expected: &str, got: &str) -> SourceMatch {
    let sentence = |answer: &str| support_bytes(text, answer);
    let words = |s: &Option<((usize, usize), Option<(usize, usize)>, usize)>| s.map(|(at, _, _)| text[at.0..at.1].to_string());
    match (declines(expected), declines(got)) {
        (true, true) => return SourceMatch { same: true, sentence: true, expected: None, got: None },
        (true, false) | (false, true) => {
            let (e, g) = (sentence(expected), sentence(got));
            return SourceMatch { same: false, sentence: false, expected: words(&e).filter(|_| !declines(expected)), got: words(&g).filter(|_| !declines(got)) };
        }
        _ => {}
    }
    let (e, g) = (sentence(expected), sentence(got));
    let cites_shown = |a: &str| cited_ordinals(a).contains(&ordinal);
    let cited_right = unsupported_citations(got, &[ordinal]).is_empty() && (!cites_shown(expected) || cites_shown(got));
    let sentence_right = match (e, g) {
        (Some((ea, eb, _)), Some((ga, gb, _))) => ea == ga || eb == Some(ga) || gb == Some(ea),
        _ => false,
    };
    SourceMatch { same: cited_right && sentence_right, sentence: sentence_right, expected: words(&e), got: words(&g) }
}

/// A carried example of a grounded Pigeon is the filled prompt it was made
/// with: one of its own sections as `material_block` writes it, a blank line,
/// then the question. That section and the question, or None when the input
/// does not start with one of this Pigeon's sections byte for byte.
pub fn split_carried<'a, 'b>(index: &'a ChunkIndex, input: &'b str) -> Option<(&'a Chunk, &'b str)> {
    index.chunks.iter().find_map(|c| {
        let rest = input.strip_prefix(material_block(c).as_str())?.strip_prefix("\n\n")?;
        let question = rest.trim();
        (!question.is_empty()).then_some((c, question))
    })
}

/// An answer that says its material does not cover the question. It has no
/// sentence it came from, so nothing is marked as its source — the word
/// overlap alone would otherwise mark whichever sentence shares "first" and
/// "article" with "the passage does not say what the first article is".
pub fn declines(answer: &str) -> bool {
    const SAYS_NOT: [&str; 16] = [
        "does not say", "doesn't say", "does not mention", "doesn't mention", "does not state",
        "doesn't state", "does not specify", "doesn't specify", "does not contain", "doesn't contain",
        "not mentioned", "not stated", "no information", "not in the passage", "cannot answer", "can't answer",
    ];
    let a = strip_citations(answer).to_lowercase().replace('’', "'");
    SAYS_NOT.iter().any(|p| a.contains(p))
}

/// Which of the shown sections the answer came from: the first one it cites
/// that has a supporting sentence, else the one whose sentence shares the most
/// words with it (the earlier on a tie). None when it declines or nothing
/// shares enough. `supports[i]` is `support_scored` for section `i`.
pub fn main_section(answer: &str, ordinals: &[u32], supports: &[Option<Support>]) -> Option<usize> {
    if declines(answer) { return None; }
    for n in cited_ordinals(answer) {
        if let Some(i) = ordinals.iter().position(|o| *o == n) {
            if supports.get(i).is_some_and(|s| s.is_some()) { return Some(i); }
        }
    }
    let mut best: Option<(usize, usize)> = None;
    for (i, s) in supports.iter().enumerate() {
        if let Some(Support { hits, .. }) = s {
            if best.map(|(_, b)| *hits > b).unwrap_or(true) { best = Some((i, *hits)); }
        }
    }
    best.map(|(i, _)| i)
}

fn strip_citations(answer: &str) -> String {
    let mut out = String::with_capacity(answer.len());
    let mut rest = answer;
    while let Some(i) = rest.find("[§") {
        out.push_str(&rest[..i]);
        match rest[i..].find(']') { Some(j) => rest = &rest[i + j + 1..], None => { rest = ""; } }
    }
    out.push_str(rest);
    out
}

/// Byte ranges of the sentences in a section, trimmed of surrounding
/// whitespace; empty ranges are dropped.
fn sentences(text: &str) -> Vec<(usize, usize)> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    while i < bytes.len() {
        let ends = matches!(bytes[i], b'.' | b';' | b'!' | b'?') && bytes.get(i + 1).is_some_and(|c| c.is_ascii_whitespace());
        let para = bytes[i] == b'\n' && bytes.get(i + 1) == Some(&b'\n');
        if ends || para {
            let end = if ends { i + 1 } else { i };
            push_trimmed(text, start, end, &mut out);
            start = end;
        }
        i += 1;
    }
    push_trimmed(text, start, text.len(), &mut out);
    out
}

fn push_trimmed(text: &str, start: usize, end: usize, out: &mut Vec<(usize, usize)>) {
    let slice = &text[start..end];
    let lead = slice.len() - slice.trim_start().len();
    let trail = slice.len() - slice.trim_end().len();
    if start + lead < end - trail { out.push((start + lead, end - trail)); }
}

// ---------------------------------------------------------------------------
// hybrid-v1 — a byte-for-byte port of Flight School's chunker.rs reference:
// the sections' paragraph vectors ride in the file (`material/embeddings.json`,
// format §8.7); the question is embedded here (embedder.rs) with the model the
// file names; each section scores by its best paragraph's cosine, blended
// with keyword-overlap-v2, z-scored across sections. Measured on the
// Constitution Reader: 142 of 176 right sections, against v2's 117.

pub const HYBRID_COSINE_WEIGHT: f64 = 0.7;
pub const HYBRID_LEXICAL_WEIGHT: f64 = 0.3;
pub const HYBRID_COSINE_FLOOR: f64 = 0.58;
pub const EMBEDDINGS_FILE: &str = "material/embeddings.json";

/// `material/embeddings.json`, as embed.py writes it.
#[derive(Deserialize, Clone, Debug)]
pub struct Embeddings {
    pub model: EmbeddingModel,
    #[serde(default)]
    pub chunks_sha256: String,
    pub units: Vec<Unit>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct EmbeddingModel {
    pub file: String,
    pub sha256: String,
    pub dims: u32,
    #[serde(default)]
    pub query_prefix: String,
}

/// One paragraph's vector. The file also says which paragraph of its section
/// it is (`part`); a section scores by its best paragraph, whichever that is,
/// so the position is not read.
#[derive(Deserialize, Clone, Debug)]
pub struct Unit {
    pub ordinal: u32,
    pub f16: String,
}

impl Embeddings {
    /// A question's vector as the file's own are written: base64 of `dims`
    /// little-endian half floats.
    pub fn unpack(&self, f16: &str) -> Option<Vec<f32>> {
        unpack_f16(f16, self.model.dims as usize)
    }
}

impl Embeddings {
    pub fn parse(raw: &[u8]) -> Result<Embeddings, String> {
        let e: Embeddings = serde_json::from_slice(raw).map_err(|err| format!("{EMBEDDINGS_FILE} could not be read — {err}"))?;
        if e.units.is_empty() {
            return Err(format!("{EMBEDDINGS_FILE} has no units in it"));
        }
        if e.model.sha256.len() != 64 || !e.model.sha256.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("{EMBEDDINGS_FILE} does not name its model's sha256"));
        }
        for (i, u) in e.units.iter().enumerate() {
            if unpack_f16(&u.f16, e.model.dims as usize).is_none() {
                return Err(format!("{EMBEDDINGS_FILE} unit {i} is not {} half floats", e.model.dims));
            }
        }
        Ok(e)
    }

    /// That these vectors are the ones made for this material, with the model
    /// this build embeds questions with. Flight School records a digest of the
    /// sections it embedded (`chunks_sha256`); a file whose sections changed
    /// after embedding would otherwise search by vectors of other text and
    /// answer from the wrong sections, reading exactly like the right ones.
    /// `dims` and `query_prefix` are the host's embedding model's.
    pub fn check(&self, index: &ChunkIndex, dims: u32, query_prefix: &str) -> Result<(), String> {
        self.check_sections(index)?;
        self.check_model(Some(dims), Some(query_prefix))
    }

    /// The half of `check` that needs nothing from the host: the vectors were
    /// made from these sections, one section for one section.
    pub fn check_sections(&self, index: &ChunkIndex) -> Result<(), String> {
        if self.chunks_sha256.is_empty() {
            return Err(format!("{EMBEDDINGS_FILE} does not say which sections its vectors were made from — pack it again with Flight School"));
        }
        if !self.chunks_sha256.eq_ignore_ascii_case(&chunks_digest(index)) {
            return Err(format!("{EMBEDDINGS_FILE} was made for different sections than the material carries — pack it again with Flight School"));
        }
        if let Some(u) = self.units.iter().find(|u| !index.chunks.iter().any(|c| c.ordinal == u.ordinal)) {
            return Err(format!("{EMBEDDINGS_FILE} has a vector for §{}, which the material does not have", u.ordinal));
        }
        if let Some(c) = index.chunks.iter().find(|c| !self.units.iter().any(|u| u.ordinal == c.ordinal)) {
            return Err(format!("{EMBEDDINGS_FILE} has no vector for §{} {}", c.ordinal, c.title));
        }
        Ok(())
    }

    /// The other half: what the host's embedding model makes is what these
    /// vectors are, as far as the host knows its own model.
    pub fn check_model(&self, dims: Option<u32>, query_prefix: Option<&str>) -> Result<(), String> {
        if let Some(dims) = dims.filter(|d| *d != self.model.dims) {
            return Err(format!("{EMBEDDINGS_FILE} holds {}-number vectors, and this app's embedding model makes {dims}", self.model.dims));
        }
        if let Some(query_prefix) = query_prefix.filter(|p| !self.model.query_prefix.is_empty() && self.model.query_prefix != *p) {
            return Err(format!("{EMBEDDINGS_FILE} asks questions with \"{}\", and this app's embedding model with \"{query_prefix}\" — update the app", self.model.query_prefix));
        }
        Ok(())
    }

    /// Every unit as (section index, vector), for an index; units of a
    /// section the index does not have are dropped.
    pub fn units_for(&self, index: &ChunkIndex) -> Vec<(usize, Vec<f32>)> {
        self.units
            .iter()
            .filter_map(|u| {
                let i = index.chunks.iter().position(|c| c.ordinal == u.ordinal)?;
                Some((i, unpack_f16(&u.f16, self.model.dims as usize)?))
            })
            .collect()
    }
}

/// Flight School's `embed.py::chunks_digest`: sha256 over each section, in
/// order, as Python's `json.dumps([ordinal, title, text], ensure_ascii=False)`
/// writes it — ", " between items, non-ASCII as itself, which is how
/// serde_json escapes a string too. `file` and `est_tokens` are not in it.
pub fn chunks_digest(index: &ChunkIndex) -> String {
    use sha2::{Digest, Sha256};
    let mut h = Sha256::new();
    for c in &index.chunks {
        let q = |s: &str| serde_json::to_string(s).unwrap_or_default();
        h.update(format!("[{}, {}, {}]", c.ordinal, q(&c.title), q(&c.text)).as_bytes());
    }
    format!("{:x}", h.finalize())
}

/// A packed unit vector: 16-bit little-endian floats, base64.
pub fn unpack_f16(b64: &str, dims: usize) -> Option<Vec<f32>> {
    let bytes = base64_decode(b64)?;
    if bytes.len() != dims * 2 { return None; }
    Some(bytes.chunks_exact(2).map(|p| half_to_f32(u16::from_le_bytes([p[0], p[1]]))).collect())
}

fn half_to_f32(h: u16) -> f32 {
    let sign = ((h >> 15) & 1) as u32;
    let exp = ((h >> 10) & 0x1f) as u32;
    let frac = (h & 0x3ff) as u32;
    let bits = if exp == 0 {
        if frac == 0 { sign << 31 } else {
            let mut e = 127 - 15 + 1;
            let mut f = frac;
            while f & 0x400 == 0 { f <<= 1; e -= 1; }
            (sign << 31) | ((e as u32) << 23) | ((f & 0x3ff) << 13)
        }
    } else if exp == 31 {
        (sign << 31) | 0x7f80_0000 | (frac << 13)
    } else {
        (sign << 31) | ((exp + 127 - 15) << 23) | (frac << 13)
    };
    f32::from_bits(bits)
}

fn base64_decode(s: &str) -> Option<Vec<u8>> {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut buf: u32 = 0;
    let mut bits = 0;
    for c in s.bytes() {
        if c == b'=' { break; }
        let v = T.iter().position(|t| *t == c)? as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 { bits -= 8; out.push(((buf >> bits) & 0xff) as u8); }
    }
    Some(out)
}

pub fn zscores(xs: &[f64]) -> Vec<f64> {
    let n = xs.len() as f64;
    if n == 0.0 { return Vec::new(); }
    let m = xs.iter().sum::<f64>() / n;
    let sd = (xs.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / n).sqrt();
    xs.iter().map(|x| if sd > 0.0 { (x - m) / sd } else { 0.0 }).collect()
}

/// The section to paste, or None under the floor. Ties to the earlier one.
pub fn hybrid_v1(cos: &[f64], lexical: &[f64]) -> Option<usize> {
    if cos.is_empty() || cos.len() != lexical.len() { return None; }
    let (zc, zl) = (zscores(cos), zscores(lexical));
    let mut best: Option<(usize, f64)> = None;
    for i in 0..cos.len() {
        let s = HYBRID_COSINE_WEIGHT * zc[i] + HYBRID_LEXICAL_WEIGHT * zl[i];
        if best.map(|(_, b)| s > b).unwrap_or(true) { best = Some((i, s)); }
    }
    best.filter(|(i, _)| cos[*i] >= HYBRID_COSINE_FLOOR).map(|(i, _)| i)
}

/// Every section's best paragraph cosine with a unit-length question vector.
pub fn best_cosines(n: usize, units: &[(usize, Vec<f32>)], q: &[f32]) -> Vec<f64> {
    let mut cos = vec![-1.0f64; n];
    for (i, v) in units {
        let d: f64 = v.iter().zip(q).map(|(a, b)| (*a as f64) * (*b as f64)).sum();
        if d > cos[*i] { cos[*i] = d; }
    }
    cos
}

/// keyword-overlap-v2's raw score per section, the lexical half of the blend.
pub fn v2_scores(index: &ChunkIndex, question: &str) -> Vec<f64> {
    let n = index.chunks.len();
    if n == 0 { return Vec::new(); }
    let docs: Vec<V2Doc> = index.chunks.iter().map(v2_doc).collect();
    let avg = docs.iter().map(|d| d.len).sum::<usize>() as f64 / n as f64;
    let mut df: std::collections::HashMap<&str, u32> = std::collections::HashMap::new();
    for d in &docs { for w in d.tf.keys() { *df.entry(w.as_str()).or_insert(0) += 1; } }
    let idf = |w: &str| -> f64 { let f = *df.get(w).unwrap_or(&0) as f64; (1.0 + (n as f64 - f + 0.5) / (f + 0.5)).ln() };
    let q = v2_tokens(question);
    let mut qset: Vec<&str> = Vec::new();
    for w in &q { if !qset.contains(&w.as_str()) { qset.push(w); } }
    let mut qbi: Vec<(&str, &str)> = Vec::new();
    for p in q.windows(2) { let b = (p[0].as_str(), p[1].as_str()); if !qbi.contains(&b) { qbi.push(b); } }
    docs.iter().map(|d| {
        let mut s = 0.0;
        for w in &qset {
            let f = *d.tf.get(*w).unwrap_or(&0) as f64;
            if f > 0.0 {
                s += idf(w) * f * (V2_K1 + 1.0) / (f + V2_K1 * (1.0 - V2_B + V2_B * d.len as f64 / avg));
                if d.title.contains(*w) { s += V2_TITLE_BONUS * idf(w); }
            }
        }
        s + V2_PHRASE_BONUS * qbi.iter().filter(|(a, b)| d.bigrams.contains(&(a.to_string(), b.to_string()))).count() as f64
    }).collect()
}

/// `hybrid-v1` for one question, its vector already made with the file's
/// model: the one best section, or none.
pub fn retrieve_hybrid<'a>(index: &'a ChunkIndex, emb: &Embeddings, qvec: &[f32], question: &str) -> Vec<&'a Chunk> {
    let units = emb.units_for(index);
    let cos = best_cosines(index.chunks.len(), &units, qvec);
    let lex = v2_scores(index, question);
    hybrid_v1(&cos, &lex).map(|i| &index.chunks[i]).into_iter().collect()
}

/// One section as the adapter saw it in training: `[§n] Title\ntext`.
pub fn material_block(chunk: &Chunk) -> String {
    format!("[§{}] {}\n{}", chunk.ordinal, chunk.title, chunk.text)
}

/// The section ordinals an answer claims, deduplicated, in order of first use.
pub fn cited_ordinals(answer: &str) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    let bytes = answer.as_bytes();
    let mut i = 0usize;
    while let Some(pos) = answer[i..].find("[§") {
        let start = i + pos + "[§".len();
        let mut end = start;
        while end < bytes.len() && bytes[end].is_ascii_digit() {
            end += 1;
        }
        if end > start && bytes.get(end) == Some(&b']') {
            if let Ok(n) = answer[start..end].parse::<u32>() {
                if !out.contains(&n) {
                    out.push(n);
                }
            }
        }
        i = start;
    }
    out
}

/// Citations of sections the model was never shown. An unverified citation
/// is decoration (§8.4).
pub fn unsupported_citations(answer: &str, shown: &[u32]) -> Vec<u32> {
    cited_ordinals(answer).into_iter().filter(|n| !shown.contains(n)).collect()
}

/// The one way in: the sections for a question under the method the file
/// names. `hybrid-v1` needs the file's vectors and the question's own vector,
/// made with the file's embedding model and scaled to unit length; every other
/// method ignores both. Empty means no section — the Runner then MUST NOT call
/// the model (§9.5). An unknown method is an error, never a fallback.
pub fn find<'a>(index: &'a ChunkIndex, method: &str, question: &str, vectors: Option<(&Embeddings, &[f32])>) -> Result<Vec<&'a Chunk>, String> {
    match (method, vectors) {
        ("hybrid-v1", Some((embeddings, qvec))) if qvec.len() == embeddings.model.dims as usize => Ok(retrieve_hybrid(index, embeddings, qvec, question)),
        ("hybrid-v1", Some((embeddings, qvec))) => Err(format!("the question's vector has {} numbers, and this Pigeon's material was embedded with {}", qvec.len(), embeddings.model.dims)),
        (_, _) => retrieve(index, method, question),
    }
}

/// The sections to paste for one question under `method`. Empty means the
/// retrieval floor found nothing, which the caller answers WITHOUT calling the
/// model (§8.6). An unknown method is an error, never a fallback.
pub fn retrieve<'a>(index: &'a ChunkIndex, method: &str, question: &str) -> Result<Vec<&'a Chunk>, String> {
    match method {
        "whole" => Ok(index.chunks.iter().collect()),
        "keyword-overlap-v1" => Ok(best_chunk_for_in(index, &haystacks(index), question).into_iter().collect()),
        "keyword-overlap-v2" => Ok(best_chunk_v2(index, question).into_iter().collect()),
        "hybrid-v1" => Err("hybrid-v1 needs the question's vector — pigeon_run embeds it first (retrieve_hybrid)".into()),
        other => Err(format!(
            "this Pigeon finds its material with \"{other}\", which this app cannot do — update the app"
        )),
    }
}

/// The template with both slots filled in ONE pass, every other byte left
/// alone (§8.3). One pass matters: material that happens to contain the text
/// `{input}` must not have the question spliced into it, and a question that
/// contains `{material}` must not be expanded.
pub fn fill(template: &str, sections: &[&Chunk], question: &str) -> String {
    let material = sections.iter().map(|c| material_block(c)).collect::<Vec<_>>().join("\n\n");
    let question = question.trim();
    let mut out = String::with_capacity(template.len() + material.len() + question.len());
    let mut rest = template;
    loop {
        let next_m = rest.find(MATERIAL_SLOT);
        let next_i = rest.find(INPUT_SLOT);
        let (at, slot, value) = match (next_m, next_i) {
            (Some(m), Some(i)) if m < i => (m, MATERIAL_SLOT, material.as_str()),
            (_, Some(i)) => (i, INPUT_SLOT, question),
            (Some(m), None) => (m, MATERIAL_SLOT, material.as_str()),
            (None, None) => break,
        };
        out.push_str(&rest[..at]);
        out.push_str(value);
        rest = &rest[at + slot.len()..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chunk(ordinal: u32, title: &str, text: &str) -> Chunk {
        Chunk { ordinal, file: "manual.md".into(), title: title.into(), text: text.into(), est_tokens: 0 }
    }

    fn index() -> ChunkIndex {
        ChunkIndex {
            chunks: vec![
                chunk(1, "Downloads", "Models download with resumable range requests."),
                chunk(2, "Voice", "The microphone uses whisper for transcription."),
            ],
            total_est_tokens: 0,
        }
    }

    #[test]
    fn a_material_block_labels_the_section_with_its_own_ordinal() {
        assert_eq!(material_block(&chunk(4, "Memory", "It needs about 3.8 GB.")), "[§4] Memory\nIt needs about 3.8 GB.");
    }

    #[test]
    fn citations_are_read_back_out_of_an_answer_deduplicated_and_in_order() {
        assert_eq!(cited_ordinals("It needs 3.8 GB [§4], and the cap is separate [§7]. See also [§4]."), vec![4, 7]);
    }

    #[test]
    fn plain_numbers_and_malformed_markers_are_not_citations() {
        assert!(cited_ordinals("4 GB, about 75%, section 4, [4], [§], [§x]").is_empty());
    }

    #[test]
    fn a_citation_of_a_section_that_was_never_shown_is_reported() {
        assert_eq!(unsupported_citations("true [§4] and also [§9]", &[4]), vec![9]);
        assert!(unsupported_citations("true [§4]", &[4, 7]).is_empty());
        assert_eq!(unsupported_citations("the manual says so [§1]", &[]), vec![1]);
    }

    #[test]
    fn best_chunk_needs_real_overlap() {
        let index = index();
        let hay = haystacks(&index);
        assert_eq!(best_chunk_for_in(&index, &hay, "how do model downloads resume?").unwrap().title, "Downloads");
        assert!(
            best_chunk_for_in(&index, &hay, "what colour is the sky?").is_none(),
            "no-overlap questions get no chunk, not the least-bad one"
        );
    }

    #[test]
    fn whole_pastes_everything_and_the_search_can_come_back_empty() {
        let index = index();
        assert_eq!(retrieve(&index, "whole", "anything").unwrap().len(), 2);
        assert_eq!(retrieve(&index, "keyword-overlap-v1", "downloads resume").unwrap()[0].ordinal, 1);
        assert!(retrieve(&index, "keyword-overlap-v1", "what colour is the sky?").unwrap().is_empty());
    }

    #[test]
    fn v2_tokens_read_ordinals_as_numerals_and_drop_stopwords() {
        assert_eq!(v2_tokens("What does the Fifteenth Amendment protect?"), vec!["xv", "amendment", "protect"]);
        assert_eq!(v2_tokens("the Twenty-second Amendment"), vec!["xxii", "amendment"]);
        assert_eq!(v2_tokens("Senators' duties and Treaties"), vec!["senator", "duty", "treaty"]);
    }

    #[test]
    fn v2_weighs_rare_words_and_titles_and_has_a_floor() {
        let index = ChunkIndex {
            chunks: vec![
                chunk(1, "Article I, Section 8", "The Congress shall have Power To declare War, grant Letters of Marque and Reprisal, and to raise and support Armies."),
                chunk(2, "Article III, Section 3", "Treason against the United States shall consist only in levying War against them. The Congress shall have Power to declare the Punishment of Treason."),
                chunk(3, "Amendment XV", "The right of citizens of the United States to vote shall not be denied on account of race."),
                chunk(4, "Downloads", "Models download with resumable range requests and are verified against pinned hashes."),
                chunk(5, "Voice", "The microphone uses whisper for transcription, and nothing leaves this machine."),
                chunk(6, "Memory", "Every model shows the memory it needs before it is downloaded."),
            ],
            total_est_tokens: 0,
        };
        assert_eq!(best_chunk_v2(&index, "What does the Fifteenth Amendment protect?").unwrap().ordinal, 3);
        assert_eq!(best_chunk_v2(&index, "Who may declare war?").unwrap().ordinal, 1);
        assert!(best_chunk_v2(&index, "how do I bake sourdough bread?").is_none());
        assert_eq!(retrieve(&index, "keyword-overlap-v2", "the punishment of treason").unwrap()[0].ordinal, 2);
    }

    /// Parity with the reference, when Flight School's checkout is beside this
    /// one: the same 176 questions, the same count. Skipped otherwise.
    #[test]
    fn v2_agrees_with_flight_schools_reference_on_the_constitution() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../flight-school/datasets/constitution-reader-v1/");
        let (Ok(chunks), Ok(qs)) = (
            std::fs::read_to_string(format!("{root}chunks.json")),
            std::fs::read_to_string(format!("{root}questions.json")),
        ) else { return };
        let index: ChunkIndex = serde_json::from_str(&chunks).unwrap();
        let qs: Vec<serde_json::Value> = serde_json::from_str(&qs).unwrap();
        let right = qs.iter().filter(|q| best_chunk_v2(&index, q["question"].as_str().unwrap()).map(|c| c.ordinal) == Some(q["section"].as_u64().unwrap() as u32)).count();
        assert_eq!(right, 117, "the port drifted from the reference");
    }

    #[test]
    fn the_supporting_sentence_is_the_one_that_shares_the_answers_words() {
        let section = "The Senate of the United States shall be composed of two Senators from each State, chosen by the Legislature thereof, for six Years; and each Senator shall have one Vote.\n\nNo Person shall be a Senator who shall not have attained to the Age of thirty Years, and been nine Years a Citizen of the United States, and who shall not, when elected, be an Inhabitant of that State for which he shall be chosen.\n\nThe Vice President of the United States shall be President of the Senate, but shall have no Vote, unless they be equally divided.";
        let Support { at: (a, b), .. } = support_scored(section, "At least thirty Years old. [§4]").unwrap();
        let marked: String = section.encode_utf16().skip(a).take(b - a).map(|u| char::from_u32(u as u32).unwrap()).collect();
        assert!(marked.starts_with("No Person shall be a Senator who shall not have attained to the Age of thirty Years"), "{marked}");
        assert!(marked.ends_with("for which he shall be chosen."), "{marked}");
        let Support { at: (a, b), .. } = support_scored(section, "Six Years, with two Senators from each State, each having one Vote. [§4]").unwrap();
        assert_eq!(&section[..], section);
        let marked: String = section.encode_utf16().skip(a).take(b - a).map(|u| char::from_u32(u as u32).unwrap()).collect();
        assert!(marked.starts_with("The Senate of the United States"), "{marked}");
        assert!(support_scored(section, "It repeals the eighteenth article. [§46]").is_none(), "nothing shared, nothing marked");
        assert!(support_scored(section, "[§4]").is_none(), "a bare citation supports nothing");
    }

    /// Article II, Section 1 as the Constitution Reader carries it. The
    /// screenshot that found the bug: "thirty-five years old" marked the "Term
    /// of four Years" sentence, because "thirty-five" never met "thirty five"
    /// and "President", "Office" and "Years" tied it with the right one.
    const ARTICLE_II_1: &str = include_str!("../tests/fixtures/article-ii-section-1.txt");

    fn marks(section: &str, answer: &str) -> (String, Option<String>) {
        let cut = |(a, b): (usize, usize)| String::from_utf16(&section.encode_utf16().skip(a).take(b - a).collect::<Vec<u16>>()).unwrap();
        let s = support_scored(section, answer).unwrap_or_else(|| panic!("nothing marked for {answer:?}"));
        (cut(s.at), s.also.map(cut))
    }

    #[test]
    fn a_number_is_matched_however_it_is_written() {
        const AGE: &str = "neither shall any Person be eligible to that Office who shall not have attained to the Age of thirty five Years";
        for answer in [
            "The president must be at least thirty-five years old to be eligible for the office. [§12]",
            "The Constitution requires the president to be at least thirty-five years old.",
            "The president must be at least 35 years old.",
            "A president must have been a resident for 14 years.",
        ] {
            let (at, also) = marks(ARTICLE_II_1, answer);
            assert!(at.starts_with(AGE), "{answer:?} marked {at:?}");
            assert_eq!(also, None, "{answer:?} marked a second clause");
        }
        let (at, _) = marks(ARTICLE_II_1, "The president serves a four-year term.");
        assert!(at.starts_with("He shall hold his Office during the Term of four Years"), "{at}");
        // A digit in the text meets a word in the answer, too.
        let (at, _) = marks("It weighs 3 kilos. It is 35 years old.", "It is thirty-five.");
        assert_eq!(at, "It is 35 years old.");
    }

    #[test]
    fn an_ordinal_stays_whole_when_hyphens_are_split() {
        assert_eq!(support_tokens("the twenty-first article"), vec!["xxi", "article"]);
        assert_eq!(support_tokens("thirty-five 35 07"), vec!["thirty", "five", "thirty", "five", "seven"]);
        assert_eq!(support_tokens("1808 and 3.8"), vec!["1808", "three", "eight"]);
    }

    #[test]
    fn a_tie_goes_to_the_sentence_whose_shared_words_are_rarer() {
        // Each sentence shares two words. "Office" is in two of them,
        // "thirty" in one: the earlier sentence used to win this.
        let section = "The President shall hold Office. The President shall leave Office. The President shall be thirty.";
        let (at, _) = marks(section, "The President is in office at thirty.");
        assert_eq!(at, "The President shall be thirty.");
    }

    #[test]
    fn an_answer_that_joins_two_clauses_marks_both_and_one_clause_marks_one() {
        let (at, also) = marks(ARTICLE_II_1, "The president must be a natural born citizen and at least thirty-five years old.");
        assert!(at.starts_with("No Person except a natural born Citizen"), "{at}");
        assert!(also.as_deref().is_some_and(|s| s.starts_with("neither shall any Person be eligible")), "{also:?}");
        // Two shared words ("Electors", "vote") are not a second clause.
        let (at, also) = marks(ARTICLE_II_1, "The day electors vote is the same throughout the United States.");
        assert_eq!(at, "which Day shall be the same throughout the United States.");
        assert_eq!(also, None);
    }

    #[test]
    fn sentences_end_at_stops_and_paragraphs_and_offsets_are_utf16() {
        let text = "Café first; then second. Third?\n\nFourth";
        let got: Vec<&str> = sentences(text).into_iter().map(|(a, b)| &text[a..b]).collect();
        assert_eq!(got, vec!["Café first;", "then second.", "Third?", "Fourth"]);
        // "é" is two bytes but one UTF-16 unit: the page slices by units.
        let Support { at: (a, b), .. } = support_scored(text, "the fourth one").unwrap();
        assert_eq!((a, b), (text.encode_utf16().count() - 6, text.encode_utf16().count()));
    }

    #[test]
    fn half_floats_and_the_blend_match_the_reference() {
        assert_eq!(unpack_f16("ADgAPADA", 3).unwrap(), vec![0.5, 1.0, -2.0]);
        assert!(unpack_f16("ADgAPADA", 4).is_none());
        assert_eq!(hybrid_v1(&[0.60, 0.80], &[9.0, 1.0]), Some(1));
        assert_eq!(hybrid_v1(&[0.80, 0.60], &[1.0, 9.0]), Some(0));
        assert_eq!(hybrid_v1(&[0.50, 0.55], &[9.0, 1.0]), None, "under the floor, no section");
        assert_eq!(hybrid_v1(&[0.70, 0.70], &[3.0, 3.0]), Some(0), "a tie goes to the earlier section");
    }

    #[test]
    fn embeddings_are_parsed_the_way_the_packer_writes_them_and_refused_when_broken() {
        let good = r#"{"model":{"name":"m","file":"m.gguf","sha256":"3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7","dims":3,"query_prefix":"q: "},"units":[{"ordinal":1,"part":0,"f16":"ADgAPADA"}]}"#;
        let e = Embeddings::parse(good.as_bytes()).unwrap();
        assert_eq!(e.units_for(&index()).len(), 1);
        assert!(Embeddings::parse(br#"{"model":{"file":"m","sha256":"3e24","dims":3},"units":[{"ordinal":1,"f16":"ADgAPADA"}]}"#).unwrap_err().contains("sha256"));
        assert!(Embeddings::parse(br#"{"model":{"file":"m","sha256":"3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7","dims":4},"units":[{"ordinal":1,"f16":"ADgAPADA"}]}"#).unwrap_err().contains("half floats"));
        assert!(Embeddings::parse(br#"{"model":{"file":"m","sha256":"3e24342164b3d94991ba9692fdc0dd08e3fd7362e0aacc396a9a5c54a544c3b7","dims":3},"units":[]}"#).unwrap_err().contains("no units"));
    }

    /// Parity with the reference: the Constitution Reader's packed vectors and
    /// the stored question vectors, when Flight School's checkout is beside
    /// this one. Skipped otherwise.
    #[test]
    fn hybrid_v1_reproduces_flight_schools_picks_on_the_constitution() {
        let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../../flight-school/datasets/constitution-reader-v1/");
        let (Ok(chunks), Ok(emb), Ok(qs)) = (
            std::fs::read_to_string(format!("{root}chunks.json")),
            std::fs::read(format!("{root}embeddings.json")),
            std::fs::read_to_string(format!("{root}queries.json")),
        ) else { return };
        let index: ChunkIndex = serde_json::from_str(&chunks).unwrap();
        let emb = Embeddings::parse(&emb).unwrap();
        // The digest is Flight School's own: the real file passes the check.
        emb.check(&index, 768, "search_query: ").unwrap();
        let qs: Vec<serde_json::Value> = serde_json::from_str(&qs).unwrap();
        for q in &qs {
            let qv = unpack_f16(q["f16"].as_str().unwrap(), emb.model.dims as usize).unwrap();
            let got = retrieve_hybrid(&index, &emb, &qv, q["question"].as_str().unwrap()).first().map(|c| c.ordinal as u64);
            assert_eq!(got, q["picked"].as_u64(), "{}", q["question"]);
        }
    }

    fn vectors_for(index: &ChunkIndex, digest: &str) -> Embeddings {
        let units: Vec<String> = index.chunks.iter().map(|c| format!(r#"{{"ordinal":{},"part":0,"f16":"ADgAPADA"}}"#, c.ordinal)).collect();
        let raw = format!(
            r#"{{"model":{{"file":"m.gguf","sha256":"{}","dims":3,"query_prefix":"q: "}},"chunks_sha256":"{digest}","units":[{}]}}"#,
            "a".repeat(64), units.join(",")
        );
        Embeddings::parse(raw.as_bytes()).unwrap()
    }

    #[test]
    fn the_sections_digest_is_embed_pys() {
        // json.dumps([1, "Downloads", "…"], ensure_ascii=False), then [2, …], hashed as one stream.
        let index = ChunkIndex { chunks: vec![chunk(1, "Dé", "a \"b\"\n\tc")], total_est_tokens: 0 };
        use sha2::{Digest, Sha256};
        let want = format!("{:x}", Sha256::digest("[1, \"Dé\", \"a \\\"b\\\"\\n\\tc\"]".as_bytes()));
        assert_eq!(chunks_digest(&index), want);
    }

    #[test]
    fn vectors_made_for_other_sections_or_another_model_are_refused() {
        let index = index();
        let good = chunks_digest(&index);
        assert!(vectors_for(&index, &good).check(&index, 3, "q: ").is_ok());
        assert!(vectors_for(&index, "").check(&index, 3, "q: ").unwrap_err().contains("does not say which sections"));
        assert!(vectors_for(&index, &"0".repeat(64)).check(&index, 3, "q: ").unwrap_err().contains("different sections"));
        assert!(vectors_for(&index, &good).check(&index, 768, "q: ").unwrap_err().contains("768"));
        assert!(vectors_for(&index, &good).check(&index, 3, "search_query: ").unwrap_err().contains("update the app"));
        // A section with no vector would score -1 and never be found.
        let mut more = index.clone();
        more.chunks.push(chunk(3, "Memory", "It needs about 3.8 GB."));
        let e = vectors_for(&index, &chunks_digest(&more));
        assert!(e.check(&more, 3, "q: ").unwrap_err().contains("no vector for §3"));
    }

    #[test]
    fn the_answer_comes_from_the_section_it_cites_else_the_one_sharing_most() {
        let s = |hits| Some(Support { at: (0, 5), also: None, hits });
        assert_eq!(main_section("Thirty years old. [§4]", &[2, 4], &[s(3), s(2)]), Some(1));
        assert_eq!(main_section("Thirty years old.", &[2, 4], &[s(2), s(3)]), Some(1));
        assert_eq!(main_section("Thirty years old.", &[2, 4], &[s(2), s(2)]), Some(0));
        // A citation of a section with no supporting sentence is passed over.
        assert_eq!(main_section("Thirty years old. [§4]", &[2, 4], &[s(2), None]), Some(0));
        assert_eq!(main_section("Nothing like it.", &[2], &[None]), None);
    }

    #[test]
    fn an_answer_that_says_its_material_does_not_cover_it_has_no_source() {
        assert!(declines("This passage does not say what the first section of the Constitution is."));
        assert!(declines("The text doesn’t mention it [§3]."));
        assert!(!declines("It is not about an establishment of religion."));
        assert_eq!(main_section("The passage does not say. It is about the second article.", &[23], &[Some(Support { at: (0, 5), also: None, hits: 2 })]), None);
    }

    #[test]
    fn an_unknown_retrieval_is_refused_by_name_never_substituted() {
        let err = retrieve(&index(), "embedding-v2", "downloads").unwrap_err();
        assert!(err.contains("embedding-v2") && err.contains("update the app"), "{err}");
    }

    #[test]
    fn the_material_goes_where_the_template_puts_it_in_one_pass() {
        let index = index();
        let shown: Vec<&Chunk> = index.chunks.iter().take(1).collect();
        assert_eq!(
            fill("{material}\n\n{input}", &shown, "  how? "),
            "[§1] Downloads\nModels download with resumable range requests.\n\nhow?"
        );
        // Slot text inside the values is never expanded a second time.
        let odd = chunk(3, "Slots", "write {input} here");
        assert_eq!(fill("{material}\n\n{input}", &[&odd], "say {material}"), "[§3] Slots\nwrite {input} here\n\nsay {material}");
        // Several sections are separated by a blank line.
        let all: Vec<&Chunk> = index.chunks.iter().collect();
        assert_eq!(
            fill("{material}|{input}", &all, "q"),
            "[§1] Downloads\nModels download with resumable range requests.\n\n[§2] Voice\nThe microphone uses whisper for transcription.|q"
        );
    }

    /// A carried example is asked with the section it carries, the way it was
    /// made, and only a section of this Pigeon's own, byte for byte, counts.
    #[test]
    fn a_carried_example_is_split_into_its_own_section_and_its_question() {
        let index = index();
        let made = format!("{}\n\nhow do downloads resume?", material_block(&index.chunks[0]));
        let (c, q) = split_carried(&index, &made).expect("its own section");
        assert_eq!((c.ordinal, q), (1, "how do downloads resume?"));
        // Another document's section, a section with no question, plain text: none.
        assert!(split_carried(&index, "[§1] Downloads\nModels download over FTP.\n\nhow?").is_none());
        assert!(split_carried(&index, &format!("{}\n\n  ", material_block(&index.chunks[0]))).is_none());
        assert!(split_carried(&index, "how do downloads resume?").is_none());
    }

    /// Kevin's test for a grounded Pigeon (2026-10-03): a right answer in other
    /// words is the same source; an answer from another sentence is not.
    #[test]
    fn two_answers_are_the_same_source_when_they_come_from_the_same_sentence() {
        let expected = "No person except a natural born Citizen shall be eligible to the Office of President. [§2]";
        let reworded = "Only a natural born citizen can be eligible to become President. [§2]";
        let m = same_source(2, ARTICLE_II_1, expected, reworded);
        assert!(m.same, "{m:?}");
        assert_eq!(m.expected, m.got);
        assert!(m.got.as_deref().unwrap().contains("natural born Citizen"));
        // From the term-of-office sentence instead: a different source, and both sentences say so.
        let other = "The President holds office for a term of four years. [§2]";
        let m = same_source(2, ARTICLE_II_1, expected, other);
        assert!(!m.same);
        assert!(m.got.as_deref().unwrap().contains("four Years"), "{m:?}");
    }

    #[test]
    fn citations_and_refusals_decide_a_source_too() {
        let expected = "No person except a natural born Citizen shall be eligible to the Office of President. [§2]";
        // The right sentence, but the citation dropped, or a section it was never shown.
        let bare = same_source(2, ARTICLE_II_1, expected, "Only a natural born citizen is eligible to be President.");
        assert!(!bare.same && bare.sentence, "{bare:?}");
        assert!(!same_source(2, ARTICLE_II_1, expected, "Only a natural born citizen is eligible to be President. [§2] [§9]").same);
        // An expected answer that cites nothing does not ask for a citation.
        assert!(same_source(2, ARTICLE_II_1, "Only natural born citizens are eligible to be President.", reworded_cite()).same);
        // Both decline: the same. One declines: not.
        let no = "The passage does not say how a President is removed.";
        assert!(same_source(2, ARTICLE_II_1, no, "The section does not mention removal. [§2]").same);
        let m = same_source(2, ARTICLE_II_1, expected, no);
        assert!(!m.same && m.got.is_none());
        // Nothing in common with the section at all: not the same.
        assert!(!same_source(2, ARTICLE_II_1, expected, "Bananas are yellow. [§2]").same);
    }

    fn reworded_cite() -> &'static str {
        "A natural born citizen is the only person eligible for President. [§2]"
    }
}

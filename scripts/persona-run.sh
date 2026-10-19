#!/bin/bash
# persona-run.sh — a Lane B persona, end to end, on one machine at a time.
#
# Five stages, and the ordering is the whole point: on 16 GB a teacher and a
# training run cannot both be resident, so each stage takes the machine and
# gives it back. Nothing here runs concurrently with anything else, and the
# script stops the servers it started even when a later stage fails.
#
#   1  teacher up          Qwen3.5-9B, alone
#   2  corpus              questions then answers, sampled per the recipe
#   3  teacher down        before a single training step
#   4  train + convert     mlx-lm LoRA, then the GGUF the app loads
#   5  install + check     into the adapters directory, then measured
#   6  shape               lanebbench --shape A, then B; the passing one is recorded
#
#   scripts/persona-run.sh model/persona-data/socratic-tutor.plan.json
#
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
PLAN="${1:?usage: scripts/persona-run.sh <plan.json>}"
ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLAN','utf8')).id)")
LABEL=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$PLAN','utf8')).label)")

TEACHER="${TEACHER:-$HOME/Library/Application Support/mode.airoplane.pigeon/models/Qwen3.5-9B-Q4_K_M.gguf}"
TEACHER_PORT="${TEACHER_PORT:-8110}"
BIN="$ROOT/src-tauri/binaries/llama-server-aarch64-apple-darwin"
ADAPTERS="$HOME/Library/Application Support/mode.airoplane.pigeon/adapters"
DATA="model/persona-data/$ID"
LOG="$ROOT/model/logs"; mkdir -p "$LOG"
STAMP=$(date '+%Y%m%d-%H%M')
RUNLOG="$LOG/$ID-run-$STAMP.log"

say () { printf '\n  ── %s\n' "$*" | tee -a "$RUNLOG"; }
teacher_pid=""
cleanup () { [ -n "$teacher_pid" ] && kill "$teacher_pid" 2>/dev/null; }
trap cleanup EXIT

say "$LABEL ($ID) — log ${RUNLOG#$ROOT/}"

# ── 1. the machine, to ourselves ────────────────────────────────────────────
say "stopping everything of ours that is up"
pkill -f "llama-server-aarch64-apple-darwin" 2>/dev/null
pkill -f "scripts/models.mjs" 2>/dev/null
sleep 3

say "teacher: $(basename "$TEACHER") on $TEACHER_PORT"
[ -f "$TEACHER" ] || { echo "  no teacher at $TEACHER"; exit 1; }
"$BIN" -m "$TEACHER" --port "$TEACHER_PORT" --host 127.0.0.1 \
  -ngl 99 -c 8192 --parallel 1 --no-warmup >>"$RUNLOG" 2>&1 &
teacher_pid=$!

for i in $(seq 1 180); do
  curl -sf -m 2 "http://127.0.0.1:$TEACHER_PORT/health" >/dev/null && break
  kill -0 "$teacher_pid" 2>/dev/null || { echo "  the teacher died while loading — see $RUNLOG"; exit 1; }
  sleep 2
done
curl -sf -m 2 "http://127.0.0.1:$TEACHER_PORT/health" >/dev/null || { echo "  the teacher never came up"; exit 1; }
say "teacher ready"

# ── 2. the corpus ───────────────────────────────────────────────────────────
say "building the corpus"
node scripts/personadata.mjs "$PLAN" --base "http://127.0.0.1:$TEACHER_PORT" \
  --per-group "${PER_GROUP:-45}" --holdout "${HOLDOUT:-20}" 2>&1 | tee -a "$RUNLOG"
[ -f "$DATA/train.jsonl" ] || { echo "  no corpus was written"; exit 1; }

# ── 3. the teacher goes away BEFORE training ────────────────────────────────
say "stopping the teacher"
kill "$teacher_pid" 2>/dev/null; teacher_pid=""
sleep 5

# ── 4. train, then convert ──────────────────────────────────────────────────
say "training"
DATA="$DATA" NAME="$ID" SEQ="${SEQ:-512}" ITERS="${ITERS:-600}" LR="${LR:-1e-5}" \
  ./scripts/train.command </dev/null 2>&1 | tee -a "$RUNLOG"
[ -f "model/$ID-adapter/adapters.safetensors" ] || { echo "  training produced no adapter"; exit 1; }

say "converting to GGUF"
scripts/convert-planner-adapter.sh "model/$ID-adapter" "model/$ID.lora.gguf" 2>&1 | tee -a "$RUNLOG"
[ -f "model/$ID.lora.gguf" ] || { echo "  no GGUF was written"; exit 1; }

# ── 5. install, then prove it ───────────────────────────────────────────────
say "installing into the adapters directory"
mkdir -p "$ADAPTERS"
cp "model/$ID.lora.gguf" "$ADAPTERS/$ID.lora.gguf"
node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({label: process.argv[2]}) + '\n')" \
  "$ADAPTERS/$ID.lora.json" "$LABEL"
ls -lh "$ADAPTERS" | tee -a "$RUNLOG"

say "restarting the models with the persona loaded inert"
node scripts/models.mjs >>"$RUNLOG" 2>&1 &
for i in $(seq 1 180); do
  curl -sf -m 2 "http://127.0.0.1:8101/health" >/dev/null && break
  sleep 2
done

say "checking the persona is actually worn"
node scripts/personacheck.mjs "$ID" 2>&1 | tee -a "$RUNLOG"

# ── 6. measure its memory shape, and record the one that passed ─────────────
say "measuring the memory shape (A: last turns sent, B: newest message only)"
node scripts/record-shape.mjs "$ID" --adapters "$ADAPTERS" 2>&1 | tee -a "$RUNLOG"
say "done — $RUNLOG"

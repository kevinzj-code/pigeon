#!/bin/bash
# overnight-round2.sh — train the category adapter (round 2) and the new
# sibling-discrimination adapter, convert both, then bench everything so the
# numbers are waiting in the morning. Sequential on the GPU; every stage logs
# to model/round2/logs/; no stage's failure skips the rest.
#
# Bash on purpose: zsh does not word-split an unquoted flag variable, which
# once ran a whole bench against the wrong router without saying so.
#
# Usage: nohup scripts/overnight-round2.sh > model/round2/logs/overnight.log 2>&1 &
#
# Where things are on this machine, each overridable from the environment:
#   FLIGHT_SCHOOL_DIR  the Flight School checkout      (default: the sibling folder ../flight-school)
#   PIGEON_DATA_DIR    forbidden.json, categories.json, dev-labelled.jsonl  (default: the repo root)
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"
LOG="$ROOT/model/round2/logs"; mkdir -p "$LOG" "$ROOT/model/round2"
FS="${FLIGHT_SCHOOL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/flight-school}"
DATA="${PIGEON_DATA_DIR:-$ROOT}"
VENV="$HOME/Library/Application Support/mode.airoplane.flightschool/venv/bin/python"
export HF_HOME="$HOME/Library/Application Support/mode.airoplane.flightschool/hf_cache"
BASE_MLX="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
BIN="$ROOT/src-tauri/binaries/llama-server-aarch64-apple-darwin"
M15="$HOME/Library/Application Support/mode.airoplane.pigeon/models/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
M2B="$HOME/Library/Application Support/mode.airoplane.pigeon/models/Qwen3.5-2B-Q4_K_M.gguf"
LORA_CFG="$ROOT/model/planner-data/lora_config.yaml"   # rank 16, scale 20
SUMMARY="$ROOT/model/round2/SUMMARY.md"
stamp() { date "+%H:%M:%S"; }
say()   { echo "[$(stamp)] $*"; }
stop_servers() { pkill -f "MacOS/llama-server" 2>/dev/null; sleep 2; }
wait_port() { local p=$1 i=0; until [ "$(curl -s -m 2 http://127.0.0.1:$p/health)" = '{"status":"ok"}' ] || [ $i -ge 120 ]; do sleep 2; i=$((i+1)); done; curl -s -m 2 http://127.0.0.1:$p/health; echo; }
lines() { grep -E "answered right|wrong skill|asked|honest|correct incl|failed|declined|leaks|avg latency|verifier" "$1"; }

say "round 2 starts"; stop_servers
: > "$SUMMARY"
echo "# Round 2 — overnight results ($(date '+%Y-%m-%d'))" >> "$SUMMARY"

# ── 1. datasets ──────────────────────────────────────────────────────────────
say "building the category set (round 2)"
CAT_OK=0
( cd "$FS" && python3 scripts/build_category_router.py \
    --seeds "$ROOT/model/training-data-v2/seeds.json" \
    --forbidden "$DATA/forbidden.json" \
    --categories "$DATA/categories.json" \
    --dev "$DATA/dev-labelled.jsonl" \
    --out "$ROOT/model/training-data-v2" --check ) > "$LOG/build-category.log" 2>&1 && CAT_OK=1
say "category set: $( [ $CAT_OK = 1 ] && echo ok || echo FAILED — see build-category.log )"
grep -E "rows|collid|reject|none" "$LOG/build-category.log" | head -12

say "building the sibling set"
SIB_OK=0
node scripts/siblingdata.mjs --out "$ROOT/model/sibling-data" > "$LOG/build-sibling.log" 2>&1 && SIB_OK=1
say "sibling set: $( [ $SIB_OK = 1 ] && echo ok || echo FAILED )"; grep -E "rows|dropped|train" "$LOG/build-sibling.log"

# ── 2. training ──────────────────────────────────────────────────────────────
train() { # name data-dir max-seq iters eval save
  local name=$1 data=$2 seq=$3 iters=$4 ev=$5 sv=$6
  say "training $name: $iters iters, seq $seq"
  rm -rf "$ROOT/model/$name-adapter"
  "$VENV" -m mlx_lm lora --model "$BASE_MLX" --train --data "$data" \
    --iters "$iters" --batch-size 1 --learning-rate 1e-5 --max-seq-length "$seq" \
    --mask-prompt --grad-checkpoint --fine-tune-type lora \
    --steps-per-eval "$ev" --save-every "$sv" -c "$LORA_CFG" \
    --adapter-path "$ROOT/model/$name-adapter" > "$LOG/train-$name.log" 2>&1
  local rc=$?
  say "training $name: exit $rc"; grep -E "Val loss" "$LOG/train-$name.log" | tail -3
  return $rc
}
CAT_TRAINED=0; SIB_TRAINED=0
if [ $CAT_OK = 1 ]; then
  N=$(grep -c "" "$ROOT/model/training-data-v2/train.jsonl"); ITERS=$(( N * 2 ))
  train category "$ROOT/model/training-data-v2" 256 "$ITERS" 500 1000 && CAT_TRAINED=1
fi
if [ $SIB_OK = 1 ]; then
  N=$(grep -c "" "$ROOT/model/sibling-data/train.jsonl"); ITERS=$(( N * 2 ))
  train sibling "$ROOT/model/sibling-data" 1024 "$ITERS" 300 700 && SIB_TRAINED=1
fi

# ── 3. convert ───────────────────────────────────────────────────────────────
CAT_GGUF="$ROOT/model/pigeon-category-v2.lora.gguf"; SIB_GGUF="$ROOT/model/pigeon-sibling.lora.gguf"
[ $CAT_TRAINED = 1 ] && { say "converting category v2"; scripts/convert-planner-adapter.sh "$ROOT/model/category-adapter" "$CAT_GGUF" > "$LOG/convert-category.log" 2>&1 || CAT_TRAINED=0; }
[ $SIB_TRAINED = 1 ] && { say "converting sibling";     scripts/convert-planner-adapter.sh "$ROOT/model/sibling-adapter"  "$SIB_GGUF" > "$LOG/convert-sibling.log"  2>&1 || SIB_TRAINED=0; }
say "converted: category=$CAT_TRAINED sibling=$SIB_TRAINED"

# ── 4. servers ───────────────────────────────────────────────────────────────
say "starting servers"
nohup "$BIN" -m "$M2B" --port 8099 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8099.log" 2>&1 &
nohup "$BIN" -m "$M15" --lora "$ROOT/model/pigeon-category.lora.gguf" --port 8101 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8101.log" 2>&1 &
[ $CAT_TRAINED = 1 ] && nohup "$BIN" -m "$M15" --lora "$CAT_GGUF" --port 8107 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8107.log" 2>&1 &
[ $SIB_TRAINED = 1 ] && nohup "$BIN" -m "$M15" --lora "$SIB_GGUF" --port 8108 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8108.log" 2>&1 &
for p in 8099 8101; do wait_port $p; done
[ $CAT_TRAINED = 1 ] && wait_port 8107; [ $SIB_TRAINED = 1 ] && wait_port 8108

# ── 5. benches ───────────────────────────────────────────────────────────────
B="--router category --trained --min-confidence 0.80 --only llm+ex --runway-auto"
bench() { local tag=$1; shift; say "bench $tag"; node scripts/plannerbench.mjs "$@" > "$LOG/bench-$tag.log" 2>&1; echo; echo "## $tag" >> "$SUMMARY"; lines "$LOG/bench-$tag.log" >> "$SUMMARY"; }

say "category accuracy on the 182-row measure-only set"
echo "## category adapter, dev-labelled (182)" >> "$SUMMARY"
( cd "$FS" && python3 scripts/eval_category_router.py --port 8101 ) > "$LOG/eval-cat-shipped.log" 2>&1; echo "shipped:  $(grep -E 'accuracy|refusals' "$LOG/eval-cat-shipped.log" | tr '\n' ' ')" >> "$SUMMARY"
[ $CAT_TRAINED = 1 ] && { ( cd "$FS" && python3 scripts/eval_category_router.py --port 8107 ) > "$LOG/eval-cat-v2.log" 2>&1; echo "round 2:  $(grep -E 'accuracy|refusals' "$LOG/eval-cat-v2.log" | tr '\n' ' ')" >> "$SUMMARY"; }

bench control $B --category-base http://127.0.0.1:8101 --second-look --misses "$LOG/misses-control.json"
[ $CAT_TRAINED = 1 ] && bench category-v2 $B --category-base http://127.0.0.1:8107 --second-look --misses "$LOG/misses-category-v2.json"
[ $SIB_TRAINED = 1 ] && bench sibling $B --category-base http://127.0.0.1:8101 --second-look --verify --verify-base http://127.0.0.1:8108 --misses "$LOG/misses-sibling.json" --verifier-log "$LOG/vlog-sibling.json"
[ $CAT_TRAINED = 1 ] && [ $SIB_TRAINED = 1 ] && bench both $B --category-base http://127.0.0.1:8107 --second-look --verify --verify-base http://127.0.0.1:8108 --misses "$LOG/misses-both.json" --verifier-log "$LOG/vlog-both.json"

stop_servers
say "done"; echo; echo "## Ship rules" >> "$SUMMARY"
cat >> "$SUMMARY" <<'EOF'
- category v2 ships if: leaks ≤ 4 AND correct incl. honest asks ≥ control AND dev accuracy ≥ shipped.
- sibling ships if: verifier (→right − →wrong) ≥ +8 AND correct ≥ control AND leaks ≤ control.
EOF
cat "$SUMMARY"

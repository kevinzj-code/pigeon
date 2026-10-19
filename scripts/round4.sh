#!/bin/bash
# round4.sh — the sibling-discrimination adapter, round 4: round 3's set
# (Flight School's skill-labelled paraphrases plus the skill examples) with
# 300 CONTRASTIVE messages added — thirty confusable pairs, five messages a
# side, shown as exactly the two cards in both orders. Round 3 reached +5 on
# the verifier's ledger against a rule of +8, and every remaining kept-wrong
# case was one of these pairs. Same training, conversion and bench as round 3.
#
# Usage:
#   nohup scripts/round4.sh > model/round4/logs/round4.log 2>&1 &
set -u
cd "$(dirname "$0")/.."
ROOT="$PWD"; LOG="$ROOT/model/round4/logs"; mkdir -p "$LOG"
VENV="$HOME/Library/Application Support/mode.airoplane.flightschool/venv/bin/python"
export HF_HOME="$HOME/Library/Application Support/mode.airoplane.flightschool/hf_cache"
BASE_MLX="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
BIN="$ROOT/src-tauri/binaries/llama-server-aarch64-apple-darwin"
M15="$HOME/Library/Application Support/mode.airoplane.pigeon/models/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
M2B="$HOME/Library/Application Support/mode.airoplane.pigeon/models/Qwen3.5-2B-Q4_K_M.gguf"
LORA_CFG="$ROOT/model/planner-data/lora_config.yaml"
DATA="$ROOT/model/sibling-data-v4"; ADAPTER="$ROOT/model/sibling-adapter-v4"; GGUF="$ROOT/model/pigeon-sibling-v4.lora.gguf"
SUMMARY="$ROOT/model/round4/SUMMARY.md"
say() { echo "[$(date '+%H:%M:%S')] $*"; }
stop_servers() { pkill -f "MacOS/llama-server" 2>/dev/null; sleep 2; }
wait_port() { local p=$1 i=0; until [ "$(curl -s -m 2 http://127.0.0.1:$p/health)" = '{"status":"ok"}' ] || [ $i -ge 120 ]; do sleep 2; i=$((i+1)); done; curl -s -m 2 http://127.0.0.1:$p/health; echo; }
lines() { grep -E "answered right|wrong skill|asked|honest|correct incl|failed|declined|leaks|avg latency|verifier" "$1"; }

say "round 4 starts"; stop_servers
: > "$SUMMARY"; echo "# Round 4 — sibling adapter on paraphrases ($(date '+%Y-%m-%d'))" >> "$SUMMARY"
echo "set: $(grep -c '' "$DATA/train.jsonl") train · $(grep -c '' "$DATA/valid.jsonl") valid" >> "$SUMMARY"

N=$(grep -c "" "$DATA/train.jsonl"); ITERS=$N
say "training sibling v4: $ITERS iters (one epoch), seq 1024"
rm -rf "$ADAPTER"
"$VENV" -m mlx_lm lora --model "$BASE_MLX" --train --data "$DATA" \
  --iters "$ITERS" --batch-size 1 --learning-rate 1e-5 --max-seq-length 1024 \
  --mask-prompt --grad-checkpoint --fine-tune-type lora \
  --steps-per-eval 500 --save-every 1000 -c "$LORA_CFG" \
  --adapter-path "$ADAPTER" > "$LOG/train.log" 2>&1
RC=$?; say "training: exit $RC"; grep -E "Val loss" "$LOG/train.log" | tail -3
TRAINED=0; [ $RC = 0 ] && { say "converting"; scripts/convert-planner-adapter.sh "$ADAPTER" "$GGUF" > "$LOG/convert.log" 2>&1 && TRAINED=1; }
say "converted: $TRAINED"

say "starting servers"
nohup "$BIN" -m "$M2B" --port 8099 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8099.log" 2>&1 &
nohup "$BIN" -m "$M15" --lora "$ROOT/model/pigeon-category.lora.gguf" --port 8101 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8101.log" 2>&1 &
[ $TRAINED = 1 ] && nohup "$BIN" -m "$M15" --lora "$GGUF" --port 8108 --host 127.0.0.1 -ngl 99 -c 8192 --parallel 1 --no-warmup > "$LOG/srv-8108.log" 2>&1 &
for p in 8099 8101; do wait_port $p; done; [ $TRAINED = 1 ] && wait_port 8108

B="--router category --category-base http://127.0.0.1:8101 --trained --min-confidence 0.80 --only llm+ex --runway-auto --second-look"
bench() { local tag=$1; shift; say "bench $tag"; node scripts/plannerbench.mjs "$@" > "$LOG/bench-$tag.log" 2>&1; echo; echo "## $tag" >> "$SUMMARY"; lines "$LOG/bench-$tag.log" >> "$SUMMARY"; }
bench control $B --misses "$LOG/misses-control.json"
[ $TRAINED = 1 ] && bench sibling-v4 $B --verify --verify-base http://127.0.0.1:8108 --misses "$LOG/misses-sibling-v4.json" --verifier-log "$LOG/vlog-sibling-v4.json"

stop_servers
say "done"; echo; echo "## Ship rule" >> "$SUMMARY"
echo "- sibling v4 ships if: verifier (→right − →wrong) ≥ +8 AND correct ≥ control AND leaks ≤ control." >> "$SUMMARY"
echo "- control is measured in THIS run, so the widened bench (308 + 100) and workstream 1 are already in it." >> "$SUMMARY"
echo "- if the ungated ledger misses +8, read vlog-sibling-v4.json for the round-3 gate (chosen == lexical top), which was +4 with zero harm." >> "$SUMMARY"
cat "$SUMMARY"

#!/bin/bash
# train.command — double-click to train a LoRA on this Mac, with the machine
# cleared out first.
#
# CLEARING THE MACHINE DOES NOT MAKE TRAINING FASTER. Measured here, paired,
# same data and same sequence length:
#
#   batch 1, seq 256    3.2-3.8 rows/sec    1.4 GB peak
#   batch 8, seq 256    3.6 rows/sec        3.0 GB peak
#
# Identical throughput. The GPU is already saturated by one row at a time, so a
# bigger batch buys nothing and costs memory. An earlier claim of "three times
# faster" came from comparing batch 4 at seq 256 against batch 1 at seq 1024 --
# different row lengths, so not a comparison at all.
#
# What clearing DOES buy is stability. On 16 GB with 2.6 GB already in swap, the
# two llama-servers the bench leaves running hold about 7 GB between them and do
# nothing during training. Stopping them keeps the machine out of swap for three
# hours. Everything else is reported, not killed -- this script does not decide
# which of your apps you need.
#
# If you want training to finish sooner, the lever is the GPU, not the RAM.
#
#   ./scripts/train.command                       category v3, the default
#   DATA=model/sibling-data-v4 SEQ=1024 ./scripts/train.command
#
set -u
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"   # Finder launches with a minimal PATH
cd "$(dirname "$0")/.."
ROOT="$PWD"

# Defaults are category v3: 6,181 rows at 13.2% refusals, rows under 121 tokens.
DATA="${DATA:-model/training-data-v3}"
SEQ="${SEQ:-256}"
BATCH="${BATCH:-1}"   # measured: batching buys nothing here, see above
EPOCHS="${EPOCHS:-1}"
LR="${LR:-1e-5}"
NAME="${NAME:-$(basename "$DATA")}"
# One config, shared by every run: rank and scale are what the converter's
# alpha assert checks, so a run that differs here has to say so out loud.
CONFIG="${CONFIG:-model/planner-data/lora_config.yaml}"

VENV="$HOME/Library/Application Support/mode.airoplane.flightschool/venv/bin/python"
export HF_HOME="$HOME/Library/Application Support/mode.airoplane.flightschool/hf_cache"
BASE="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
OUT="$ROOT/model/$NAME-adapter"
LOG="$ROOT/model/logs"; mkdir -p "$LOG"
STAMP=$(date '+%Y%m%d-%H%M')

free_gb () { vm_stat | awk '/page size of/{p=$8} /Pages free/{f=$3} /Pages inactive/{i=$3} END{gsub("\\.","",f); gsub("\\.","",i); printf "%.1f", (f+i)*p/1073741824}'; }
swap_gb () { /usr/sbin/sysctl -n vm.swapusage | sed 's/.*used = \([0-9.]*\)M.*/\1/' | awk '{printf "%.1f", $1/1024}'; }

echo ""
echo "  Pigeon · train $NAME"
echo "  ─────────────────────────────────────────────"
echo "  before      $(free_gb) GB available · $(swap_gb) GB swap in use"

# ── clear what is ours and idle ─────────────────────────────────────────────
if pgrep -qf "MacOS/llama-server"; then
  echo "  stopping    $(pgrep -cf 'MacOS/llama-server') llama-server(s) — the bench's, idle during training"
  pkill -f "MacOS/llama-server"
  pkill -f "scripts/models.mjs"
  sleep 3
fi

# ── report the rest, decide nothing ─────────────────────────────────────────
echo "  after       $(free_gb) GB available · $(swap_gb) GB swap in use"
echo "  still up    $(ps -Ao rss=,ucomm= | sort -rn | head -5 | awk '$1 > 204800 {printf "%s %.1fGB, ", $2, $1/1048576}' | sed 's/, $//')"
echo "  ─────────────────────────────────────────────"

# Name the set before spending the time on it. A clean run on the wrong rows
# measures nothing, and it has already happened once.
[ -f "$DATA/DATASET.txt" ] && { echo "  dataset"; sed 's/^/    /' "$DATA/DATASET.txt"; }

ROWS=$(grep -c '' "$DATA/train.jsonl")
ITERS="${ITERS:-$(( ROWS * EPOCHS / BATCH ))}"   # override only for a timing probe
# An overridden ITERS makes EPOCHS a lie, and a run that misreports how many
# times it saw the data is one nobody can compare later. Say the real number.
PASSES=$(awk -v i="$ITERS" -v r="$ROWS" -v b="$BATCH" 'BEGIN{printf "%.2g", i*b/r}')
echo "  data        $ROWS rows · $(grep -c '' "$DATA/valid.jsonl") valid"
echo "  settings    batch $BATCH · seq $SEQ · lr $LR · $PASSES passes over the data"
echo "  iterations  $ITERS"
echo "  adapter     ${OUT#$ROOT/}"
echo "  log         model/logs/$NAME-$STAMP.log"
echo ""
echo "  Batching is off by default because it measured no faster. If you"
echo "  raise it, remember a bigger batch is not the same run: fewer steps"
echo "  per epoch, different loss curve. Compare bench scores, never loss."
echo ""

rm -rf "$OUT"
"$VENV" -m mlx_lm lora --model "$BASE" --train --data "$ROOT/$DATA" \
  --iters "$ITERS" --batch-size "$BATCH" --learning-rate "$LR" \
  --max-seq-length "$SEQ" --mask-prompt --grad-checkpoint --fine-tune-type lora \
  --steps-per-eval 200 --save-every 500 -c "$ROOT/$CONFIG" \
  --adapter-path "$OUT" 2>&1 | tee "$LOG/$NAME-$STAMP.log"

RC=${PIPESTATUS[0]}
echo ""
if [ "$RC" = 0 ]; then
  echo "  Done in $(grep -c '^Iter' "$LOG/$NAME-$STAMP.log") logged steps. Adapter: ${OUT#$ROOT/}"
  grep -E "Peak mem" "$LOG/$NAME-$STAMP.log" | tail -1
  echo "  Convert with: scripts/convert-planner-adapter.sh ${OUT#$ROOT/} model/$NAME.lora.gguf"
else
  echo "  Training exited $RC — see model/logs/$NAME-$STAMP.log"
fi
echo ""
read -n 1 -s -r -p "  Press any key to close."
echo ""

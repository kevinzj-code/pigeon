#!/bin/bash
# convert-planner-adapter.sh — the trained mlx adapter, as the GGUF LoRA the app loads.
#
# Two hops, both borrowed from Flight School and both verified there:
#   mlx-lm adapter  →  PEFT layout   (src-tauri/python/mlx_adapter_to_peft.py)
#   PEFT layout     →  LoRA GGUF     (llama.cpp's convert_lora_to_gguf.py)
#
# The one detail that decides whether the result is right or quietly wrong:
# mlx-lm applies its `scale` directly, PEFT applies `lora_alpha / r`, so the
# PEFT config must carry lora_alpha = scale × rank (20 × 16 = 320). The check
# at the end reads that number back out of the GGUF; if it is not 320 the
# adapter will load cleanly and be scaled wrong.
#
# Verified 2026-09-03 on the 40-iteration probe adapter before the real run.
#
# Usage: scripts/convert-planner-adapter.sh [adapter-dir] [out.gguf]
#
# Where things are on this machine, each overridable from the environment:
#   FLIGHT_SCHOOL_DIR  the Flight School checkout  (default: the sibling folder ../flight-school)
#   LLAMA_CPP_DIR      a llama.cpp checkout         (default ~/llama.cpp)
set -euo pipefail
ADAPTER_DIR="${1:-model/planner-adapter}"
OUT="${2:-model/pigeon-planner.lora.gguf}"
FS="${FLIGHT_SCHOOL_DIR:-$(cd "$(dirname "$0")/../.." && pwd)/flight-school}"
LLAMA_CPP="${LLAMA_CPP_DIR:-$HOME/llama.cpp}"
CV="$HOME/Library/Application Support/mode.airoplane.flightschool/venv-convert/bin/python"
export HF_HOME="$HOME/Library/Application Support/mode.airoplane.flightschool/hf_cache"
BASE="mlx-community/Qwen2.5-1.5B-Instruct-4bit"
WORK="$(mktemp -d)"

echo "==> mlx adapter -> PEFT"
"$CV" "$FS/src-tauri/python/mlx_adapter_to_peft.py" \
  --adapter-dir "$ADAPTER_DIR" --out-dir "$WORK/peft" --base-model "$BASE" --adapter-name pigeon-planner

echo "==> PEFT -> GGUF"
BASE_DIR="$("$CV" -c "from huggingface_hub import snapshot_download; print(snapshot_download('$BASE', allow_patterns=['*.json'], local_files_only=True))")"
"$CV" "$LLAMA_CPP/convert_lora_to_gguf.py" "$WORK/peft" --base "$BASE_DIR" --outtype f16 --outfile "$OUT" 2>&1 | grep -E "successfully|Error|error" || true

echo "==> checking the result"
"$CV" - "$OUT" <<'PY'
import sys, gguf
r = gguf.GGUFReader(sys.argv[1])
kv = {f.name: f.parts[f.data[0]].tolist() for f in r.fields.values() if f.data}
alpha = kv["adapter.lora.alpha"][0]
arch = bytes(kv["general.architecture"]).decode()
print(f"  {sys.argv[1]}: arch {arch}, alpha {alpha}, {len(r.tensors)} tensors")
assert arch == "qwen2", arch
assert abs(alpha - 320.0) < 1e-6, f"alpha is {alpha}, expected 320 = scale 20 x rank 16"
print("  ok")
PY
rm -rf "$WORK"
ls -lh "$OUT"

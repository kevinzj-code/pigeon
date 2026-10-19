#!/usr/bin/env python3
"""train_category_lora.py — LoRA for the tool-category classifier.

Trains Qwen2.5-1.5B-Instruct to read a request and emit one of 23 category names,
or "none". CPU only: this machine has an AMD Phoenix iGPU with no ROCm, so there
is no accelerator path that does not involve a 30 GB unofficial detour.

Two things matter more than the hyperparameters:

1. THE LOSS IS MASKED TO THE ANSWER. Only the assistant's category tokens carry
   a label; the system prompt and the question are -100. Without this the model
   spends its capacity learning to reproduce an 80-token system prompt it will
   never be asked to write, and the thing we actually want — three tokens of
   answer — is a rounding error in the loss.

2. THE PROMPT FORMAT MUST MATCH INFERENCE EXACTLY. The rows are rendered with
   the model's own chat template, the same one llama-server applies via
   /apply-template. A template mismatch between training and serving produces an
   adapter that scores well here and does nothing in the app.
"""

import argparse, json, time, os
from pathlib import Path

import torch
from torch.utils.data import Dataset, DataLoader
from transformers import AutoTokenizer, AutoModelForCausalLM, get_cosine_schedule_with_warmup
from peft import LoraConfig, get_peft_model

BASE = "Qwen/Qwen2.5-1.5B-Instruct"


class Rows(Dataset):
    def __init__(self, path, tok, max_len):
        self.rows, self.tok, self.max_len = [], tok, max_len
        for line in Path(path).read_text().splitlines():
            if line.strip():
                self.rows.append(json.loads(line))

    def __len__(self):
        return len(self.rows)

    def __getitem__(self, i):
        msgs = self.rows[i]["messages"]
        prompt_msgs, answer = msgs[:-1], msgs[-1]["content"]
        # the prompt exactly as the server will send it, ending at the point the
        # assistant begins to speak
        prompt = self.tok.apply_chat_template(prompt_msgs, tokenize=False, add_generation_prompt=True)
        p_ids = self.tok(prompt, add_special_tokens=False)["input_ids"]
        a_ids = self.tok(answer + self.tok.eos_token, add_special_tokens=False)["input_ids"]
        ids = (p_ids + a_ids)[: self.max_len]
        # -100 everywhere except the answer: see note 1 in the module docstring
        labels = ([-100] * len(p_ids) + a_ids)[: self.max_len]
        return {"input_ids": ids, "labels": labels}


def collate(batch, pad_id):
    n = max(len(b["input_ids"]) for b in batch)
    out = {"input_ids": [], "labels": [], "attention_mask": []}
    for b in batch:
        k = n - len(b["input_ids"])
        out["input_ids"].append(b["input_ids"] + [pad_id] * k)
        out["labels"].append(b["labels"] + [-100] * k)
        out["attention_mask"].append([1] * len(b["input_ids"]) + [0] * k)
    return {k: torch.tensor(v) for k, v in out.items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", required=True)
    ap.add_argument("--valid", required=True)
    ap.add_argument("--out", default="adapter")
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--max-len", type=int, default=160)
    ap.add_argument("--threads", type=int, default=0)
    ap.add_argument("--dev", default=None, help="labelled dev set; enables periodic accuracy checks")
    ap.add_argument("--eval-every", type=int, default=0)
    ap.add_argument("--time-only", type=int, default=0, help="run N steps, report the rate, write nothing")
    ap.add_argument("--checkpoint", action="store_true", help="gradient checkpointing: saves memory, costs ~40% speed")
    ap.add_argument("--bf16", action="store_true", help="bfloat16 WEIGHTS — fast, but the optimiser also works in bf16")
    ap.add_argument("--amp", action="store_true", help="fp32 weights, bf16 compute — the safe way to get the speed")
    args = ap.parse_args()

    if args.threads:
        torch.set_num_threads(args.threads)
    print(f"  torch {torch.__version__} · {torch.get_num_threads()} threads · CPU")

    tok = AutoTokenizer.from_pretrained(BASE)
    dtype = torch.bfloat16 if args.bf16 else torch.float32
    model = AutoModelForCausalLM.from_pretrained(BASE, dtype=dtype)
    model.config.use_cache = False
    # checkpointing recomputes activations to save memory. With 46 GB of RAM and
    #    a 1.5B model there is nothing to save, and it costs roughly 40% of the
    #    speed — so it is off unless asked for. 
    if args.checkpoint:
        model.gradient_checkpointing_enable()

    lora = LoraConfig(
        r=args.rank, lora_alpha=args.rank * 2, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"  trainable {trainable/1e6:.1f}M of {total/1e6:.0f}M  ({100*trainable/total:.2f}%)")

    ds = Rows(args.train, tok, args.max_len)
    pad = tok.pad_token_id if tok.pad_token_id is not None else tok.eos_token_id
    dl = DataLoader(ds, batch_size=args.batch, shuffle=True,
                    collate_fn=lambda b: collate(b, pad))
    lens = [len(ds[i]["input_ids"]) for i in range(0, len(ds), max(1, len(ds) // 200))]
    print(f"  {len(ds)} rows · median length {sorted(lens)[len(lens)//2]} tokens · max {max(lens)}")

    steps = int(len(dl) * args.epochs)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=args.lr)
    sched = get_cosine_schedule_with_warmup(opt, int(steps * 0.03), steps)

    # Held-out accuracy, measured by generating the answer exactly as the app
    # will. A falling loss is not the same as a working classifier: loss can
    # improve while the model still emits a plausible-but-wrong category, and
    # the thing we actually ship is the argmax.
    dev = []
    if args.dev:
        for line in Path(args.dev).read_text().splitlines():
            if line.strip():
                r = json.loads(line)
                dev.append((r["text"], r["category"]))
        print(f"  dev set: {len(dev)} questions")

    system = json.loads(Path(args.train).read_text().splitlines()[0])["messages"][0]["content"]

    @torch.no_grad()
    def dev_accuracy():
        model.eval()
        right = 0
        for text, want in dev:
            msgs = [{"role": "system", "content": system}, {"role": "user", "content": text}]
            prompt = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
            ids = tok(prompt, return_tensors="pt", add_special_tokens=False)
            out = model.generate(**ids, max_new_tokens=6, do_sample=False,
                                 pad_token_id=pad, use_cache=True)
            got = tok.decode(out[0][ids["input_ids"].shape[1]:], skip_special_tokens=True).strip()
            right += (got == want)
        model.train()
        return right / len(dev)

    best = -1.0
    model.train()
    t0, done, running = time.time(), 0, 0.0
    stop = args.time_only or steps
    while done < stop:
        for batch in dl:
            # autocast keeps the weights and optimiser state in fp32 while the
            # matmuls run in bf16. Casting the weights themselves to bf16 is
            # faster still, but then AdamW updates 18M parameters in a format
            # with 8 bits of mantissa, and small updates vanish into rounding.
            if args.amp:
                with torch.autocast("cpu", dtype=torch.bfloat16):
                    out = model(**batch)
            else:
                out = model(**batch)
            out.loss.backward()
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
            opt.step(); sched.step(); opt.zero_grad(set_to_none=True)
            running += out.loss.item(); done += 1
            if done % 10 == 0 or done == stop:
                rate = (time.time() - t0) / done
                left = (stop - done) * rate
                print(f"  step {done}/{stop}  loss {running/done:.4f}  {rate:.2f}s/step  eta {left/60:.0f}m", flush=True)
            if dev and args.eval_every and done % args.eval_every == 0 and not args.time_only:
                acc = dev_accuracy()
                flag = ""
                if acc > best:
                    best = acc
                    Path(args.out).mkdir(parents=True, exist_ok=True)
                    model.save_pretrained(args.out)
                    tok.save_pretrained(args.out)
                    flag = "  <- saved, best so far"
                print(f"  step {done}: dev accuracy {acc*100:.1f}%{flag}", flush=True)
            if done >= stop:
                break

    if args.time_only:
        rate = (time.time() - t0) / done
        print(f"\n  {rate:.2f}s per step over {done} steps")
        print(f"  a full run of {steps} steps would take {steps*rate/3600:.1f} hours")
        return

    if dev:
        acc = dev_accuracy()
        print(f"  final dev accuracy {acc*100:.1f}%  (best during training {best*100:.1f}%)")
        if acc <= best:
            print(f"  keeping the earlier checkpoint — the final weights are no better")
            print(f"\n  adapter at {args.out}")
            return
    Path(args.out).mkdir(parents=True, exist_ok=True)
    model.save_pretrained(args.out)
    tok.save_pretrained(args.out)
    print(f"\n  adapter written to {args.out}")


if __name__ == "__main__":
    main()

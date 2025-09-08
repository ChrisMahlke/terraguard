"""
Minimal QLoRA fine-tune script for gpt-oss:20b using a small JSONL.

Inputs:
- DATA: path to a JSONL with objects like {"task":"extract","input":...,"gold":{...}}
- BASE: HF repo id for base model (default: openai/gpt-oss-20b)
- OUT:  output directory for the LoRA adapter

This uses 4-bit base weights and small LoRA ranks to fit on a single L4.
"""

import json
import os
from dataclasses import dataclass

from datasets import load_dataset
from peft import LoraConfig
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)
import torch, os
from trl import SFTTrainer


@dataclass
class Config:
    data_path: str = os.environ.get("DATA", os.path.expanduser("~/data/sft/train_extract.jsonl"))
    base_model: str = os.environ.get("BASE", "openai/gpt-oss-20b")
    output_dir: str = os.environ.get("OUT", os.path.expanduser("~/terraguard-ft-gptoss-20b"))
    max_steps: int = int(os.environ.get("MAX_STEPS", "80"))
    seq_len: int = int(os.environ.get("SEQ_LEN", "2048"))


SYSTEM = (
    "You are an offline disaster-response triage assistant. Return ONLY valid "
    "JSON matching ExtractResponse. No prose. No code fences."
)


def build_prompt(text: str) -> str:
    return (
        f"<|system|>\n{SYSTEM}\n<|end|>\n"
        f"<|user|>\nTEXT:\n{text}\n\nRespond ONLY with JSON for ExtractResponse.\n<|end|>\n"
        f"<|assistant|>"
    )


def main() -> None:
    cfg = Config()
    os.makedirs(os.path.dirname(cfg.output_dir), exist_ok=True)

    ds = load_dataset("json", data_files=cfg.data_path)["train"]

    def map_row(ex):
        user = (ex.get("input") or "").strip()
        gold = ex.get("gold")
        # Some loaders can coerce timestamps to datetime; serialize robustly
        gold_str = (
            gold
            if isinstance(gold, str)
            else json.dumps(gold, ensure_ascii=False, default=str)
        )
        return {"text": build_prompt(user), "labels": gold_str}

    train = ds.map(map_row, remove_columns=[c for c in ds.column_names if c not in ("input", "gold")])

    tok = AutoTokenizer.from_pretrained(cfg.base_model, use_fast=True)
    # Robust 4-bit path (requires Transformers >= 4.58, bitsandbytes >= 0.43)
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,
    )
    model = AutoModelForCausalLM.from_pretrained(
        cfg.base_model, quantization_config=bnb, device_map="auto"
    )

    lora = LoraConfig(r=8, lora_alpha=16, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM")

    trainer = SFTTrainer(
        model=model,
        tokenizer=tok,
        train_dataset=train,
        dataset_text_field="text",
        max_seq_length=cfg.seq_len,
        packing=False,
        peft_config=lora,
        args=dict(
            output_dir=cfg.output_dir,
            num_train_epochs=1,
            per_device_train_batch_size=1,
            gradient_accumulation_steps=8,
            learning_rate=2e-4,
            logging_steps=5,
            save_strategy="steps",
            save_steps=50,
            max_steps=cfg.max_steps,
            bf16=True,
        ),
    )

    trainer.train()
    trainer.model.save_pretrained(cfg.output_dir)
    tok.save_pretrained(cfg.output_dir)
    print("Saved adapter to", cfg.output_dir)


if __name__ == "__main__":
    main()



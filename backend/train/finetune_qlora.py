# backend/train/finetune_qlora.py
import os, json
from dataclasses import dataclass, field
from typing import Dict, List
from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,
)
from peft import LoraConfig, get_peft_model
from trl import SFTTrainer, SFTConfig

MODEL_NAME = os.environ.get("BASE_MODEL", "openai/gpt-oss-20b")  # <-- adjust to HF id if needed
OUTPUT_DIR = os.environ.get("OUT_DIR", "outputs/terraguard-qlora")
TRAIN_PATH = os.environ.get("TRAIN_PATH", "data/sft/train.jsonl")
EVAL_PATH  = os.environ.get("EVAL_PATH",  "data/sft/eval.jsonl")

# QLoRA (4-bit) – requires bitsandbytes (CUDA)
bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_use_double_quant=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype="bfloat16",
)

lora_cfg = LoraConfig(
    r=16, lora_alpha=32, lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
    target_modules=["q_proj","k_proj","v_proj","o_proj","gate_proj","up_proj","down_proj"]
)

# Build training strings from messages (prompt/response format)
def format_example(ex):
    msgs = ex["messages"]
    # Concatenate system+user as prompt; assistant content as label
    system = next((m["content"] for m in msgs if m["role"]=="system"), "")
    user   = next((m["content"] for m in msgs if m["role"]=="user"), "")
    out    = next((m["content"] for m in msgs if m["role"]=="assistant"), "")
    prompt = f"<|system|>\n{system}\n<|user|>\n{user}\n<|assistant|>\n"
    return {"text": prompt + out}

def main():
    # Load data
    ds_train = load_dataset("json", data_files=TRAIN_PATH, split="train").map(format_example, remove_columns=["messages"])
    ds_eval  = load_dataset("json", data_files=EVAL_PATH,  split="train").map(format_example, remove_columns=["messages"])

    tok = AutoTokenizer.from_pretrained(MODEL_NAME, use_fast=True)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token

    base = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        quantization_config=bnb_config,
        device_map="auto",
        trust_remote_code=True
    )

    model = get_peft_model(base, lora_cfg)

    sft_cfg = SFTConfig(
        output_dir=OUTPUT_DIR,
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=8,
        eval_strategy="steps",
        eval_steps=200,
        logging_steps=50,
        save_steps=200,
        save_total_limit=2,
        num_train_epochs=2,
        learning_rate=1e-4,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        bf16=True,                       # A100-friendly
        max_seq_length=2048,
        packing=False
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tok,
        train_dataset=ds_train,
        eval_dataset=ds_eval,
        args=sft_cfg,
        dataset_text_field="text",
    )

    trainer.train()
    trainer.save_model()          # saves PEFT adapter
    tok.save_pretrained(OUTPUT_DIR)

if __name__ == "__main__":
    main()

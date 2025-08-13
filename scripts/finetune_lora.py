import argparse, json, os
from datasets import load_dataset
from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments
from transformers import DataCollatorForLanguageModeling
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers.trainer import Trainer

def format_example(ex):
    # concat chat into a single prompt->completion string (JSON-only answers)
    msgs = ex["messages"]
    text = ""
    for m in msgs:
        role = m["role"]; content = m["content"]
        if role == "system":
            text += f"<|system|>\n{content}\n"
        elif role == "user":
            text += f"<|user|>\n{content}\n"
        else:
            text += f"<|assistant|>\n{content}\n"
    # want to predict assistant JSON only
    return {"text": text}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base_model", type=str, required=True, help="HF id, e.g. openai/gpt-oss-20b")
    ap.add_argument("--data", type=str, default="finetune/dataset.jsonl")
    ap.add_argument("--out", type=str, default="finetune/out")
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad_accum", type=int, default=16)
    ap.add_argument("--epochs", type=int, default=1)
    ap.add_argument("--lr", type=float, default=2e-4)
    args = ap.parse_args()

    ds = load_dataset("json", data_files=args.data, split="train")
    ds = ds.map(format_example, remove_columns=ds.column_names)

    tok = AutoTokenizer.from_pretrained(args.base_model, use_fast=True)
    tok.pad_token = tok.eos_token

    print("Loading base model…")
    model = AutoModelForCausalLM.from_pretrained(
        args.base_model,
        load_in_4bit=True,           # QLoRA
        device_map="auto",
        trust_remote_code=True
    )
    model = prepare_model_for_kbit_training(model)
    lconf = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05,
        target_modules=["q_proj","v_proj","k_proj","o_proj","gate_proj","up_proj","down_proj"],
        bias="none", task_type="CAUSAL_LM"
    )
    model = get_peft_model(model, lconf)

    def tok_fn(ex):
        return tok(ex["text"], truncation=True, max_length=2048)

    ds_tok = ds.map(tok_fn, batched=True, remove_columns=ds.column_names)

    collator = DataCollatorForLanguageModeling(tok, mlm=False)

    os.makedirs(args.out, exist_ok=True)
    targs = TrainingArguments(
        output_dir=args.out,
        per_device_train_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        learning_rate=args.lr,
        bf16=True,
        logging_steps=10,
        save_strategy="epoch"
    )

    trainer = Trainer(model=model, args=targs, train_dataset=ds_tok, data_collator=collator)
    trainer.train()

    # Save adapter
    model.save_pretrained(os.path.join(args.out, "adapter"))
    tok.save_pretrained(args.out)
    print("Saved LoRA adapter to", os.path.join(args.out, "adapter"))

if __name__ == "__main__":
    main()

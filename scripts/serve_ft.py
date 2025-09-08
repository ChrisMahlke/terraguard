"""
Tiny FastAPI server that wraps a HF model (base + optional LoRA adapter) and exposes /api/generate.

Env:
- BASE: HF base model id (e.g., openai/gpt-oss-20b)
- ADAPTER: optional path to a PEFT adapter dir (e.g., ~/terraguard-ft-gptoss-20b)
"""

import os
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel
import torch

BASE = os.environ.get("BASE", "openai/gpt-oss-20b")
ADAPTER = os.environ.get("ADAPTER")

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

tok = AutoTokenizer.from_pretrained(BASE, use_fast=True)
model = AutoModelForCausalLM.from_pretrained(BASE, torch_dtype=torch.bfloat16, device_map="auto")
if ADAPTER:
    model = PeftModel.from_pretrained(model, ADAPTER)
model.eval()


class GenReq(BaseModel):
    prompt: str
    max_new_tokens: int | None = 64


@app.post("/api/generate")
def generate(req: GenReq):
    inputs = tok(req.prompt, return_tensors="pt").to(model.device)
    out = model.generate(**inputs, max_new_tokens=req.max_new_tokens or 64)
    text = tok.decode(out[0], skip_special_tokens=True)
    # naive echo strip: return only the new text after the prompt
    content = text[len(req.prompt) :].strip()
    return {"response": content}



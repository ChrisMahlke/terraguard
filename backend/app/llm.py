from __future__ import annotations
import os, json, re
from typing import Any, Dict, Optional, List
import requests
from jsonschema import validate as json_validate, ValidationError
from .plan_schema import PLAN_SCHEMA

OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
MODEL = os.environ.get("TG_MODEL", "gpt-oss:20b")

SYSTEM_PLAN = (
  "You are a disaster response planner. "
  "Always return ONLY a single JSON object matching this schema:\n"
  f"{json.dumps(PLAN_SCHEMA, indent=2)}\n"
  "Do not include prose outside of JSON. Prefer concise, operational language."
)

SYSTEM_AGENT = (
  "You are a planning agent that may call tools. "
  "Return a JSON with keys: plan {summary, phases[]}, and calls[] where each call is "
  '{"tool":"route_between","args":{"start":[lng,lat],"end":[lng,lat],"purpose":"string"}}. '
  "No text outside JSON."
)

def _sanitize_fences(txt: str) -> str:
    t = txt.strip()
    if t.startswith("```"):
        t = t.removeprefix("```json").removeprefix("```").strip()
    if t.endswith("```"):
        t = t[:-3].strip()
    return t

def _ollama_chat(model: str, messages: List[Dict[str, str]], **kw) -> str:
    payload = {
        "model": model,
        "messages": messages,
        "stream": False,
        "options": {"num_ctx": 8192},
        "keep_alive": "30m",
    }
    payload.update(kw)

    r = requests.post(f"{OLLAMA_URL}/api/chat", json=payload, timeout=600)
    r.raise_for_status()

    # Prefer single JSON; fall back to NDJSON concat; finally raw text
    try:
        data = r.json()
        if isinstance(data, dict):
            if isinstance(data.get("message"), dict) and "content" in data["message"]:
                return data["message"]["content"]
            if "content" in data:  # some builds
                return data["content"]
    except ValueError:
        # NDJSON fallback
        out = []
        for line in r.text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                msg = (obj.get("message") or {}).get("content")
                if msg:
                    out.append(msg)
            except Exception:
                continue
        if out:
            return "".join(out)

    return r.text

def _coerce_json(txt: str) -> Optional[Dict[str, Any]]:
    t = _sanitize_fences(txt)
    # direct parse
    try:
        return json.loads(t)
    except Exception:
        pass
    # largest {...} block
    m = re.search(r"\{.*\}", t, flags=re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None

class LLM:
    def __init__(self):
        self.model = MODEL

    # ---- public API used by main.py ----
    def generate_plan(self, prompt: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        user = self._make_user_prompt(prompt, context)
        out = self._ask_json(SYSTEM_PLAN, user)
        return out

    def propose_actions(self, prompt: str, context: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        user = self._make_user_prompt(prompt, context)
        out = self._ask_json(SYSTEM_AGENT, user, expect_calls=True)
        return out

    # ---- helpers ----
    def _make_user_prompt(self, prompt: str, context: Optional[Dict[str, Any]]) -> str:
        ctx = context or {}
        return json.dumps({"prompt": prompt, "context": ctx})

    def _ask_json(self, system_prompt: str, user_prompt: str, expect_calls: bool=False) -> Dict[str, Any]:
        # 1st attempt
        txt = _ollama_chat(self.model, [
            {"role":"system","content": system_prompt},
            {"role":"user","content": user_prompt}
        ])
        obj = _coerce_json(txt)

        if not obj:
            # one retry with an explicit error hint
            txt = _ollama_chat(self.model, [
                {"role":"system","content": system_prompt},
                {"role":"user","content": user_prompt + "\n\nReturn ONLY strict JSON. No backticks, no extra text."}
            ])
            obj = _coerce_json(txt)
            if not obj:
                # last resort: minimal stub so API stays stable
                return {"plan":{"summary": "Model failed to return JSON.", "phases":[]}, "calls":[]}

        # Validate / normalize
        if expect_calls:
            plan = obj.get("plan") or {"summary":"", "phases":[]}
            calls = obj.get("calls") or []
            if not isinstance(calls, list):
                calls = []
            plan = {
              "summary": plan.get("summary",""),
              "phases": [{"name": p.get("name",""), "actions": p.get("actions",[])} for p in plan.get("phases",[])]
            }
            return {"plan": plan, "calls": calls}

        # Plan mode: validate against schema; patch small misses
        try:
            json_validate(instance=obj, schema=PLAN_SCHEMA)
            return obj
        except ValidationError:
            safe = {
              "summary": obj.get("summary",""),
              "phases": obj.get("phases",[]),
              "evac_routes": obj.get("evac_routes",[]),
              "resources": obj.get("resources",{}),
              "communications": obj.get("communications",[]),
              "risks": obj.get("risks",[])
            }
            return safe

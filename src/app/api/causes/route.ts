import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

function extractFirstJson(s: string) {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function normalize(o: any) {
  const out: Record<string,string> = {
    GCC: "", GCC_NAME: "", CAUSE_CODE: "", CAUSE_NAME: ""
  };
  if (o && typeof o === "object") {
    for (const k of Object.keys(out)) {
      const v = (o as any)[k];
      out[k] = (v == null ? "" : String(v)).trim();
    }
  }
  if (/^\d{1,2}$/.test(out.GCC)) out.GCC = out.GCC.padStart(2,"0");
  if (/^\d{1,2}$/.test(out.CAUSE_CODE)) out.CAUSE_CODE = out.CAUSE_CODE.padStart(2,"0");
  return out;
}

const GCC_NAMES: Record<string,string> = {
  "01": "Firesetting",
  "02": "Natural",
  "03": "Equipment",
  "04": "Electrical",
  "05": "Flame/Heat",
  "06": "Exposure",
  "07": "Unknown",
};

const CAUSE_TO_GCC: Record<string,{gcc:string; name:string}> = {
  "01": { gcc: "01", name: "Firesetting" },
  "02": { gcc: "05", name: "Flame/Heat" },
  "03": { gcc: "05", name: "Flame/Heat" },
  "04": { gcc: "03", name: "Equipment" },
  "05": { gcc: "03", name: "Equipment" },
  "06": { gcc: "04", name: "Electrical" },
  "07": { gcc: "03", name: "Equipment" },
  "08": { gcc: "05", name: "Flame/Heat" },
  "09": { gcc: "05", name: "Flame/Heat" },
  "10": { gcc: "03", name: "Equipment" },
  "11": { gcc: "02", name: "Natural" },
  "12": { gcc: "06", name: "Exposure" },
  "13": { gcc: "07", name: "Unknown" },
  "14": { gcc: "03", name: "Equipment" },
  "16": { gcc: "07", name: "Unknown" },
};

function enforceConsistency(o: Record<string,string>) {
  const cc = o.CAUSE_CODE;
  if (CAUSE_TO_GCC[cc]) {
    const { gcc, name } = CAUSE_TO_GCC[cc];
    o.GCC = gcc;
    o.GCC_NAME = name;
  } else if (GCC_NAMES[o.GCC]) {
    o.GCC_NAME = GCC_NAMES[o.GCC];
  }
  return o;
}

// Load PCC priors (JSON array) -> map
type Prior = {PCC:number; CAUSE_CODE:string; CAUSE_NAME:string; GCC:string; GCC_NAME:string};
let PCC_PRIORS: Record<string, Prior> = {};
try {
  const p = path.resolve(process.cwd(), "data/priors/pcc_top.json");
  const txt = fs.readFileSync(p, "utf-8");
  const arr = JSON.parse(txt) as Prior[];
  if (Array.isArray(arr)) {
    for (const r of arr) {
      PCC_PRIORS[String(r.PCC)] = r;
    }
  }
} catch { /* no priors yet */ }

function parsePCCFromText(t: string): string | null {
  const m = t.match(/PCC\s*=\s*(\d{1,3})/i);
  return m ? String(parseInt(m[1], 10)) : null;
}

function validate(o: Record<string,string>) {
  const errors: string[] = [];
  const req = ["GCC","GCC_NAME","CAUSE_CODE","CAUSE_NAME"];
  for (const k of req) if (!o[k]) errors.push(`Missing ${k}`);
  if (o.GCC && !/^\d{2}$/.test(o.GCC)) errors.push("GCC must be 2 digits");
  if (o.CAUSE_CODE && !/^\d{2}$/.test(o.CAUSE_CODE)) errors.push("CAUSE_CODE must be 2 digits");
  return { valid: errors.length === 0, errors };
}

export async function POST(req: Request) {
  const { text } = await req.json();
  const base = process.env.OLLAMA_BASE || "http://127.0.0.1:8000";
  const body = JSON.stringify({
    prompt: `Incident record:\n${text}\n\nReturn JSON only.`,
    max_new_tokens: 64,
  });

  const r = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const data = await r.json().catch(() => ({ response: "" }));
  const raw = typeof data?.response === "string" ? data.response : "";
  const parsed = extractFirstJson(raw);
  let normalized = normalize(parsed);

  // 1) Align group <-> cause
  normalized = enforceConsistency(normalized);

  // 2) If still Unknown (07/13), and PCC prior exists, use it (safe fallback)
  if (normalized.GCC === "07" && normalized.CAUSE_CODE === "13") {
    const pcc = parsePCCFromText(text);
    if (pcc && PCC_PRIORS[pcc]) {
      const prior = PCC_PRIORS[pcc];
      normalized = {
        GCC: prior.GCC,
        GCC_NAME: prior.GCC_NAME,
        CAUSE_CODE: prior.CAUSE_CODE,
        CAUSE_NAME: prior.CAUSE_NAME,
      };
    }
  }

  const check = validate(normalized);
  return NextResponse.json({
    model: data?.model ?? "unknown",
    raw,
    result: normalized,
    ...check,
  });
}

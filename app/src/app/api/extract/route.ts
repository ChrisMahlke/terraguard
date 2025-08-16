// src/app/api/extract/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_BASE =
  process.env.OLLAMA_BASE?.replace(/\/$/, "") || "http://127.0.0.1:11434";

function stripCodeFences(s: string): string {
  return s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1");
}
function betweenTags(s: string, open: string, close: string): string | null {
  const i = s.indexOf(open);
  const j = s.indexOf(close, i + open.length);
  if (i !== -1 && j !== -1) return s.slice(i + open.length, j);
  return null;
}
function extractBalancedJson(s: string): string | null {
  const tryStarts = ["{", "["] as const;
  for (const startCh of tryStarts) {
    const start = s.indexOf(startCh);
    if (start === -1) continue;
    const endCh = startCh === "{" ? "}" : "]";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"' && s[i - 1] !== "\\") inStr = !inStr;
      if (inStr) continue;
      if (ch === startCh) depth++;
      else if (ch === endCh) {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
  }
  return null;
}
function coerce(val: any): { reports: any[] } {
  if (Array.isArray(val)) return { reports: val };
  if (val && Array.isArray(val.reports)) return { reports: val.reports };
  if (val && typeof val === "object") return { reports: [val] };
  return { reports: [] };
}
function parseModelJson(raw: string): { reports: any[] } {
  const candidates: string[] = [];
  candidates.push(raw);
  const noFences = stripCodeFences(raw);
  if (noFences !== raw) candidates.push(noFences);
  const tag = betweenTags(raw, "<json>", "</json>");
  if (tag) candidates.push(tag);
  const balanced = extractBalancedJson(raw);
  if (balanced) candidates.push(balanced);
  const uniq = Array.from(new Set(candidates.filter(Boolean)));
  for (const c of uniq) {
    try {
      const parsed = JSON.parse(c);
      return coerce(parsed);
    } catch {}
  }
  throw new Error("Model did not return valid JSON");
}

type ExtractedReport = {
  id?: string;
  location_text: string | null;
  time_iso: string | null;
  severity: "low" | "moderate" | "high" | "critical" | null;
  needs: string[];
  dedupe_key?: string | null;
  notes?: string | null;
};
type ExtractResponse = { reports: ExtractedReport[] };

function systemPrompt() {
  return `
You are an offline disaster-response triage assistant.

Return ONLY valid JSON that conforms to this type:

type ExtractResponse = {
  reports: Array<{
    location_text: string | null;   // free-text place (do NOT invent coordinates)
    time_iso: string | null;        // ISO-8601 if present, else null
    severity: "low" | "moderate" | "high" | "critical" | null;
    needs: string[];                // e.g., ["medical","rescue","water"]
    dedupe_key?: string | null;
    notes?: string | null;
  }>;
};

Rules:
- Output JSON ONLY. No prose, no code fences, no explanations.
- Never include latitude/longitude.
- If multiple reports are present, return multiple items.
- Normalize time to ISO-8601 only if explicitly present or clearly inferable.
- Severity rubric: critical (life-threatening/ongoing), high (major damage/blocked access),
  moderate (non-life-threatening), low (minor).`;
}

function userPrompt(text: string) {
  return `TEXT:
${text}

Respond ONLY with JSON for ExtractResponse.`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    text?: string;
    model?: string;
  } | null;
  const text = body?.text?.trim();
  const model = (body?.model || "gpt-oss:20b").trim();
  if (!text)
    return NextResponse.json({ error: 'Missing "text"' }, { status: 400 });

  const prompt = `${systemPrompt()}\n\n${userPrompt(text)}\n`;

  try {
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.0, num_ctx: 2048 },
      }),
    });

    if (!r.ok) {
      const err = await r.text().catch(() => r.statusText);
      return NextResponse.json(
        { error: `Ollama error: ${r.status} ${err}` },
        { status: 503 }
      );
    }
    const data = (await r.json()) as { response?: string };
    const raw = (data.response || "").trim();
    const core = parseModelJson(raw);

    const out: ExtractResponse = {
      reports: (core.reports || []).map((rep: any, i: number) => ({
        id: crypto.randomUUID?.() ?? `rep-${Date.now()}-${i}`,
        location_text: rep?.location_text ?? null,
        time_iso: rep?.time_iso ?? null,
        severity: (["low", "moderate", "high", "critical"].includes(
          rep?.severity
        )
          ? rep.severity
          : null) as ExtractedReport["severity"],
        needs: Array.isArray(rep?.needs) ? rep.needs : [],
        dedupe_key: rep?.dedupe_key ?? null,
        notes: rep?.notes ?? null,
      })),
    };

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

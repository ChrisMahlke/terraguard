// src/app/api/extract/ensemble/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_BASE =
  process.env.OLLAMA_BASE?.replace(/\/$/, "") || "http://127.0.0.1:11434";

type Severity = "low" | "moderate" | "high" | "critical" | null;

type ExtractedReport = {
  id?: string;
  location_text: string | null;
  time_iso: string | null;
  severity: Severity;
  needs: string[];
  dedupe_key?: string | null;
  notes?: string | null;

  // New: confidence metadata
  confidence_overall?: number; // 0..1
  confields?: {
    location_text?: number;
    time_iso?: number;
    severity?: number;
    needs?: number;
  };
};

type ExtractResponse = { reports: ExtractedReport[] };

// ---------- Prompt ----------
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

// ---------- JSON salvage helpers ----------
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
function coerceToExtractResponse(val: any): ExtractResponse {
  if (Array.isArray(val)) return { reports: val };
  if (val && Array.isArray(val.reports)) return { reports: val.reports };
  if (val && typeof val === "object") return { reports: [val] };
  return { reports: [] };
}
function parseModelJson(raw: string): ExtractResponse {
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
      return coerceToExtractResponse(parsed);
    } catch {
      /* try next */
    }
  }
  throw new Error("Model did not return valid JSON");
}

// ---------- Merge helpers ----------
function norm(s: string | null | undefined) {
  return (s ?? "").trim().toLowerCase();
}
function minuteBucket(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  // bucket to minutes for dedupe
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()} ${d.getUTCHours()}:${d.getUTCMinutes()}`;
}
function makeKey(r: ExtractedReport) {
  const loc = norm(r.location_text);
  const time = minuteBucket(r.time_iso);
  const sev = r.severity ?? "";
  const needs = Array.isArray(r.needs)
    ? [...r.needs]
        .map((n) => n.toLowerCase().trim())
        .sort()
        .join(",")
    : "";
  // prefer explicit dedupe_key if provided
  return r.dedupe_key
    ? `d:${norm(r.dedupe_key)}`
    : `k:${loc}|${time}|${sev}|${needs}`;
}
function majority<T>(arr: T[]): { value: T | null; count: number } {
  const m = new Map<string, number>();
  let best: { value: T | null; count: number } = { value: null, count: 0 };
  for (const v of arr) {
    const key = JSON.stringify(v ?? null);
    const c = (m.get(key) || 0) + 1;
    m.set(key, c);
    if (c > best.count) best = { value: v ?? null, count: c };
  }
  return best;
}
function needsConsensus(allNeeds: string[][], k: number) {
  const counts = new Map<string, number>();
  for (const list of allNeeds) {
    for (const n of list || []) {
      const key = n.toLowerCase().trim();
      if (!key) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const chosen: string[] = [];
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const threshold = Math.ceil(k / 2); // majority
  for (const [need, c] of entries) {
    if (c >= threshold) chosen.push(need);
  }
  if (chosen.length === 0) {
    // fallback: top 3
    for (const [need] of entries.slice(0, 3)) chosen.push(need);
  }
  const conf =
    entries.length === 0
      ? 0
      : Math.min(
          1,
          chosen.reduce((acc, n) => acc + (counts.get(n) || 0), 0) /
            (k * Math.max(1, chosen.length))
        );
  return { needs: chosen, conf };
}

// ---------- Handler ----------
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    text?: string;
    samples?: number;
  } | null;
  const text = body?.text?.trim();
  const samples = Math.max(2, Math.min(6, body?.samples ?? 3)); // 2..6
  if (!text)
    return NextResponse.json({ error: 'Missing "text"' }, { status: 400 });

  // quick reachability check
  const ping = await fetch(`${OLLAMA_BASE}/api/tags`).catch(() => null);
  if (!ping || !ping.ok) {
    return NextResponse.json(
      { error: `Cannot reach Ollama at ${OLLAMA_BASE}. Is it running?` },
      { status: 503 }
    );
  }

  const prompt = `${systemPrompt()}\n\n${userPrompt(text)}\n`;

  const runs: ExtractResponse[] = [];
  for (let i = 0; i < samples; i++) {
    const temp = i === 0 ? 0.0 : 0.6; // one deterministic + some diverse
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
        prompt,
        stream: false,
        options: { temperature: temp, num_ctx: 2048 },
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => r.statusText);
      return NextResponse.json(
        { error: `Ollama error: ${r.status} ${errText}` },
        { status: 503 }
      );
    }
    const data = (await r.json()) as { response?: string };
    const content = (data.response ?? "").trim();
    if (!content) continue;
    try {
      runs.push(parseModelJson(content));
    } catch {
      // skip bad runs
    }
  }

  // Merge runs
  const buckets = new Map<
    string,
    {
      locs: (string | null)[];
      times: (string | null)[];
      sevs: Severity[];
      needs: string[][];
      notes: (string | null)[];
      dedupe_keys: (string | null)[];
    }
  >();

  for (const run of runs) {
    for (const rep of run.reports || []) {
      const key = makeKey(rep);
      if (!buckets.has(key))
        buckets.set(key, {
          locs: [],
          times: [],
          sevs: [],
          needs: [],
          notes: [],
          dedupe_keys: [],
        });
      const b = buckets.get(key)!;
      b.locs.push(rep.location_text ?? null);
      b.times.push(rep.time_iso ?? null);
      b.sevs.push(
        (["low", "moderate", "high", "critical"].includes(rep?.severity as any)
          ? rep.severity
          : null) as Severity
      );
      b.needs.push(Array.isArray(rep.needs) ? rep.needs : []);
      b.notes.push(rep.notes ?? null);
      b.dedupe_keys.push(rep.dedupe_key ?? null);
    }
  }

  const merged: ExtractedReport[] = [];
  for (const [_, b] of buckets) {
    const k = runs.length || 1;

    const locMaj = majority(b.locs);
    const timeMaj = majority(b.times);
    const sevMaj = majority(b.sevs);
    const needsMaj = needsConsensus(b.needs, k);
    const notesMaj = majority(b.notes);
    const dedupMaj = majority(b.dedupe_keys);

    const confLoc = locMaj.count / k;
    const confTime = timeMaj.count / k;
    const confSev = sevMaj.count / k;
    const confNeeds = needsMaj.conf;

    // overall: average of available fields
    const parts = [confLoc, confTime, confSev, confNeeds].filter(
      (n) => !isNaN(n)
    );
    const overall = parts.length
      ? parts.reduce((a, b) => a + b, 0) / parts.length
      : 0;

    merged.push({
      id:
        crypto.randomUUID?.() ??
        `rep-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      location_text: (locMaj.value as string | null) ?? null,
      time_iso: (timeMaj.value as string | null) ?? null,
      severity: (sevMaj.value as Severity) ?? null,
      needs: needsMaj.needs,
      notes: (notesMaj.value as string | null) ?? null,
      dedupe_key: (dedupMaj.value as string | null) ?? null,
      confidence_overall: Number(overall.toFixed(3)),
      confields: {
        location_text: Number(confLoc.toFixed(3)),
        time_iso: Number(confTime.toFixed(3)),
        severity: Number(confSev.toFixed(3)),
        needs: Number(confNeeds.toFixed(3)),
      },
    });
  }

  return NextResponse.json({ reports: merged } satisfies ExtractResponse);
}

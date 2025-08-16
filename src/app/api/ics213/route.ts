// src/app/api/ics213/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";
const OLLAMA_BASE =
  process.env.OLLAMA_BASE?.replace(/\/$/, "") || "http://127.0.0.1:11434";

type Report = {
  id: string;
  location_text: string | null;
  time_iso: string | null;
  severity: "low" | "moderate" | "high" | "critical" | null;
  needs: string[];
  notes?: string | null;
};

function systemPrompt() {
  return `
You fill ICS-213 (General Message) using the provided incident snippet.
Return STRICT JSON with fields:

{
  "to": string,
  "from": string,
  "subject": string,
  "message": string,
  "approved_by": string | null,
  "date_time": string  // ISO-8601
}

Rules:
- No extra keys. No prose. No code fences.
- message should be concise, actionable, and reference location/time if provided.
- Do NOT invent names; use generic roles if unclear (e.g., "Operations", "Staging").`;
}

function stripFences(s: string) {
  return s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
}
function tryParseJson(s: string) {
  const candidates = [s, stripFences(s)];
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {}
  }
  throw new Error("Model did not return valid JSON");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    report?: Report;
    to?: string;
    from?: string;
    subject?: string;
  } | null;

  if (!body?.report)
    return NextResponse.json({ error: "Missing report" }, { status: 400 });
  const { report, to, from, subject } = body;

  const prompt = `${systemPrompt()}

REPORT:
${JSON.stringify(report, null, 2)}

PREFERENCES:
${JSON.stringify(
  { to: to || null, from: from || null, subject: subject || null },
  null,
  2
)}

Return ONLY the JSON object.`;

  try {
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
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
    const parsed = tryParseJson(raw);

    // light validation
    const out = {
      to: String(parsed?.to ?? (to || "Operations")),
      from: String(parsed?.from ?? (from || "Triage")),
      subject: String(parsed?.subject ?? (subject || "General Message")),
      message: String(parsed?.message ?? "See details in attached report."),
      approved_by: parsed?.approved_by ?? null,
      date_time: String(parsed?.date_time ?? new Date().toISOString()),
    };

    return NextResponse.json(out);
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

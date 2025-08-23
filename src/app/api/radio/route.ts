// src/app/api/radio/route.ts
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

function sys() {
  return `
You create concise, plain-text radio transmissions in English and Spanish.
Return STRICT JSON:

{ "en": string, "es": string }

Rules:
- <= 18 words each.
- Use plain words a field team would say on radio.
- Include location/time if present.
- No code fences or extra fields.`;
}
function stripFences(s: string) {
  return s.replace(/```(?:json)?\s*([\s\S]*?)\s*```/gi, "$1").trim();
}
function parse(s: string) {
  const tries = [s, stripFences(s)];
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  throw new Error("bad json");
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    report?: Report;
  } | null;
  if (!body?.report)
    return NextResponse.json({ error: "Missing report" }, { status: 400 });

  const prompt = `${sys()}

REPORT:
${JSON.stringify(body.report, null, 2)}

Return ONLY the JSON above.`;

  try {
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
        prompt,
        stream: false,
        options: { temperature: 0.3, num_ctx: 2048 },
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
    const j = parse(raw);
    const en = String(j?.en || "").trim();
    const es = String(j?.es || "").trim();
    if (!en || !es)
      return NextResponse.json({ error: "Empty radio text" }, { status: 500 });
    return NextResponse.json({ en, es });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

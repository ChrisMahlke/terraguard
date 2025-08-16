// src/app/api/sitrep/route.ts
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
  risk_score?: number;
};

function systemPrompt() {
  return `
You are an offline incident command assistant. Produce a concise SITREP (situation report)
summarizing incidents for operations leaders under time pressure.

OUTPUT RULES:
- Return PLAIN TEXT only (no code fences).
- 6 to 8 short lines max.
- Start with "SITREP — <HH:MM local>".
- Include: total incidents; counts by severity; top needs; top 1–2 risks (with locations);
  recommended next 3 actions; logistics note if applicable.
- Be factual; do not invent data.`;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    reports?: Report[];
  } | null;
  const reports = Array.isArray(body?.reports) ? body!.reports! : [];
  if (reports.length === 0) {
    return NextResponse.json({ error: "No reports provided" }, { status: 400 });
  }

  // Prepare a compact input snapshot the model can handle comfortably offline.
  const compact = reports.slice(0, 50).map((r) => ({
    id: r.id,
    loc: r.location_text,
    t: r.time_iso,
    sev: r.severity,
    needs: r.needs,
    risk: r.risk_score ?? null,
    notes: r.notes ?? null,
  }));

  const prompt = `${systemPrompt()}

INPUT JSON:
${JSON.stringify(
  { now_iso: new Date().toISOString(), reports: compact },
  null,
  2
)}

Return ONLY the plain-text SITREP (6–8 lines).`;

  try {
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-oss:20b",
        prompt,
        stream: false,
        options: { temperature: 0.2, num_ctx: 2048 },
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
    const text = (data.response || "").trim();
    if (!text)
      return NextResponse.json(
        { error: "Empty response from model" },
        { status: 500 }
      );
    return NextResponse.json({ text });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

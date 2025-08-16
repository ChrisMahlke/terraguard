// src/app/api/extract/stream/route.ts
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
function coerceToExtractResponse(val: any): { reports: any[] } {
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
      return coerceToExtractResponse(parsed);
    } catch {
      /* try next */
    }
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
    location_text: string | null;
    time_iso: string | null;
    severity: "low" | "moderate" | "high" | "critical" | null;
    needs: string[];
    dedupe_key?: string | null;
    notes?: string | null;
  }>;
};

Rules:
- Output JSON ONLY. No prose, no code fences, no explanations.
- Never include latitude/longitude.
- If multiple reports are present, return multiple items.
- Normalize time only if explicitly present or clearly inferable.`;
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
  if (!text) {
    return NextResponse.json({ error: 'Missing "text"' }, { status: 400 });
  }

  const prompt = `${systemPrompt()}\n\n${userPrompt(text)}\n`;

  try {
    const r = await fetch(`${OLLAMA_BASE}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: true,
        options: { temperature: 0.0, num_ctx: 2048 },
      }),
    });

    if (!r.ok || !r.body) {
      const msg = !r.ok ? `Ollama error: ${r.status}` : "No body from Ollama";
      const errResp = new ReadableStream({
        async start(controller) {
          const enc = new TextEncoder();
          controller.enqueue(
            enc.encode(JSON.stringify({ type: "error", message: msg }) + "\n")
          );
          controller.close();
        },
      });
      return new Response(errResp, {
        headers: {
          "Content-Type": "application/x-ndjson",
          "Cache-Control": "no-store",
        },
      });
    }

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        const write = async (obj: any) =>
          controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));

        await write({
          type: "status",
          message: "model_started",
          base: OLLAMA_BASE,
        });

        const reader = r.body!.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let full = "";

        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });

            let idx: number;
            while ((idx = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line) continue;
              try {
                const j = JSON.parse(line);
                if (typeof j.response === "string" && j.response.length > 0) {
                  full += j.response;
                  await write({ type: "token", value: j.response });
                }
                if (j.done) {
                  await write({ type: "status", message: "model_complete" });
                }
              } catch {
                // ignore partials
              }
            }
          }

          try {
            const core = parseModelJson(full);
            const parsed: ExtractResponse = {
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
            await write({ type: "parsed", data: parsed });
          } catch (e: any) {
            await write({ type: "error", message: String(e?.message || e) });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

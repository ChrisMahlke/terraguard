// src/app/api/health/route.ts
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const OLLAMA_BASE =
  process.env.OLLAMA_BASE?.replace(/\/$/, "") || "http://127.0.0.1:11434";

export async function GET() {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { cache: "no-store" });
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, base: OLLAMA_BASE, status: r.status },
        { status: 200 }
      );
    }
    const data = await r.json();
    const models = Array.isArray(data?.models)
      ? data.models.map((m: any) => m?.name).filter(Boolean)
      : [];
    return NextResponse.json({ ok: true, base: OLLAMA_BASE, models });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, base: OLLAMA_BASE, error: String(e?.message || e) },
      { status: 200 }
    );
  }
}

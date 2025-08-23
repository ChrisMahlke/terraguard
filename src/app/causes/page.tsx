"use client";
import { useState } from "react";

export default function CausesTester() {
  const [text, setText] = useState(
    "STATE=MA\nFDID=09298\nINC_DATE=2024-09-20\nINC_NO=1252\nEXP_NO=0\nPCC=12"
  );
  const [out, setOut] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setOut(null);
    const res = await fetch("/api/causes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    setOut(data);
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 780, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, marginBottom: 12 }}>NFIRS Cause tester</h1>
      <p style={{ opacity: 0.8, marginBottom: 8 }}>
        Paste one incident record (NFIRS-style fields). Click <b>Classify cause</b>.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
      />
      <div style={{ marginTop: 10 }}>
        <button onClick={run} disabled={busy} style={{ padding: "8px 14px" }}>
          {busy ? "Running..." : "Classify cause"}
        </button>
      </div>
      {out && (
        <pre style={{ marginTop: 16, padding: 12, background: "#111", color: "#eee", overflow: "auto" }}>
{JSON.stringify(out, null, 2)}
        </pre>
      )}
    </div>
  );
}

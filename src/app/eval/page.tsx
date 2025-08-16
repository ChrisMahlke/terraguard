// src/app/eval/page.tsx
"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Container,
  Paper,
  Stack,
  TextField,
  Typography,
  Grid,
  Chip,
  CircularProgress,
  Alert,
} from "@mui/material";

type RunRes = { ok: boolean; ms: number; json?: any; error?: string };

export default function EvalPage() {
  const [inputs, setInputs] = useState<string>(
    `Bridge on Pine St is cracked, 2:15pm, 5 people trapped, need medical and rescue.
Senior center at 12th & Maple lost power around 3:40pm; residents need blankets and backup oxygen.
Gas smell reported at 1200 Cedar St apt 3B; alarms active; occupants evacuating; need fire dept.`
  );
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<
    Array<{ input: string; base: RunRes; ens: RunRes }>
  >([]);
  const [err, setErr] = useState<string | null>(null);

  const runEval = async () => {
    setLoading(true);
    setErr(null);
    setRows([]);
    try {
      const lines = inputs
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20);

      const run = async (body: any, url: string) => {
        const t0 = performance.now();
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          const ms = performance.now() - t0;
          const j = await r.json().catch(() => ({}));
          if (!r.ok)
            return {
              ok: false,
              ms,
              error: j?.error || `HTTP ${r.status}`,
            } as RunRes;
          return { ok: true, ms, json: j } as RunRes;
        } catch (e: any) {
          const ms = performance.now() - t0;
          return { ok: false, ms, error: String(e?.message || e) } as RunRes;
        }
      };

      const out: Array<{ input: string; base: RunRes; ens: RunRes }> = [];
      for (const line of lines) {
        const base = await run({ text: line }, "/api/extract");
        const ens = await run(
          { text: line, samples: 3 },
          "/api/extract/ensemble"
        );
        out.push({ input: line, base, ens });
      }
      setRows(out);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const validJSON = (r: RunRes) =>
    r.ok && r.json && Array.isArray(r.json?.reports);
  const total = rows.length;
  const baseValid = rows.filter((r) => validJSON(r.base)).length;
  const ensValid = rows.filter((r) => validJSON(r.ens)).length;
  const baseAvgMs = Math.round(
    rows.reduce((a, r) => a + (r.base.ms || 0), 0) / Math.max(1, total)
  );
  const ensAvgMs = Math.round(
    rows.reduce((a, r) => a + (r.ens.ms || 0), 0) / Math.max(1, total)
  );

  return (
    <>
      <Container maxWidth="lg" sx={{ mt: 10, mb: 6 }}>
        <Typography variant="h4" sx={{ mb: 2 }}>
          Eval (quick check)
        </Typography>
        <Typography variant="body2" sx={{ mb: 2, opacity: 0.85 }}>
          Paste a few sample inputs (one per line). This will run the{" "}
          <b>base</b> extractor and the <b>ensemble</b> extractor and show
          JSON-valid rate and latency.
        </Typography>

        {err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        )}

        <TextField
          label="Inputs (one per line)"
          value={inputs}
          onChange={(e) => setInputs(e.target.value)}
          multiline
          minRows={6}
          fullWidth
        />

        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button
            onClick={runEval}
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} /> : undefined}
            disabled={loading}
          >
            {loading ? "Running…" : "Run"}
          </Button>
          <Chip
            label={`Base valid: ${baseValid}/${total} (avg ${baseAvgMs} ms)`}
          />
          <Chip
            label={`Ensemble valid: ${ensValid}/${total} (avg ${ensAvgMs} ms)`}
          />
        </Stack>

        <Grid container spacing={2} sx={{ mt: 2 }}>
          {rows.map((row, i) => (
            <Grid item xs={12} key={i}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  {row.input}
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={12} md={6}>
                    <Typography variant="caption">Base</Typography>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1,
                        maxHeight: 220,
                        overflow: "auto",
                        fontSize: 12,
                        bgcolor: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 1,
                      }}
                    >
                      {row.base.ok
                        ? JSON.stringify(row.base.json, null, 2)
                        : `✖ ${row.base.error}`}
                    </Box>
                  </Grid>
                  <Grid item xs={12} md={6}>
                    <Typography variant="caption">Ensemble</Typography>
                    <Box
                      component="pre"
                      sx={{
                        m: 0,
                        p: 1,
                        maxHeight: 220,
                        overflow: "auto",
                        fontSize: 12,
                        bgcolor: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 1,
                      }}
                    >
                      {row.ens.ok
                        ? JSON.stringify(row.ens.json, null, 2)
                        : `✖ ${row.ens.error}`}
                    </Box>
                  </Grid>
                </Grid>
              </Paper>
            </Grid>
          ))}
        </Grid>
      </Container>
    </>
  );
}

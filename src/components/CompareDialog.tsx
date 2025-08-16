// src/components/CompareDialog.tsx
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Grid,
  Paper,
  Stack,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Box,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import type { RootState } from "../lib/store";
import { useSelector } from "react-redux";

type RunResult = {
  ok: boolean;
  ms: number;
  error?: string;
  json?: any;
};

export default function CompareDialog({
  open,
  onClose,
  text,
}: {
  open: boolean;
  onClose: () => void;
  text: string;
}) {
  const baseTag = useSelector((s: RootState) => s.model.baseTag);
  const fineTag = useSelector((s: RootState) => s.model.fineTag);

  const [loading, setLoading] = useState(false);
  const [baseRes, setBaseRes] = useState<RunResult | null>(null);
  const [ensRes, setEnsRes] = useState<RunResult | null>(null);
  const [fineRes, setFineRes] = useState<RunResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runAll = async () => {
    setLoading(true);
    setErr(null);
    setBaseRes(null);
    setEnsRes(null);
    setFineRes(null);
    try {
      const run = async (fn: () => Promise<Response>): Promise<RunResult> => {
        const t0 = performance.now();
        try {
          const r = await fn();
          const ms = performance.now() - t0;
          const j = await r.json().catch(() => ({}));
          if (!r.ok)
            return { ok: false, ms, error: j?.error || `HTTP ${r.status}` };
          return { ok: true, ms, json: j };
        } catch (e: any) {
          const ms = performance.now() - t0;
          return { ok: false, ms, error: String(e?.message || e) };
        }
      };

      // Base
      const base = await run(() =>
        fetch("/api/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, model: baseTag }),
        })
      );
      setBaseRes(base);

      // Ensemble
      const ens = await run(() =>
        fetch("/api/extract/ensemble", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text, samples: 3 }),
        })
      );
      setEnsRes(ens);

      // Fine (optional – will error if model not present)
      if (fineTag) {
        const fine = await run(() =>
          fetch("/api/extract", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text, model: fineTag }),
          })
        );
        setFineRes(fine);
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async (v: any) => {
    if (!v) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(v, null, 2));
    } catch {}
  };

  const Cell = ({ title, res }: { title: string; res: RunResult | null }) => (
    <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="subtitle2">{title}</Typography>
          {res ? (
            <Chip size="small" label={`${Math.round(res.ms)} ms`} />
          ) : null}
          {res ? (
            <Chip
              size="small"
              color={res.ok ? "success" : "error"}
              label={res.ok ? "OK" : "ERR"}
            />
          ) : null}
        </Stack>
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1,
            minHeight: 180,
            maxHeight: 300,
            overflow: "auto",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            borderRadius: 1,
            bgcolor: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          {res
            ? res.ok
              ? JSON.stringify(res.json, null, 2)
              : `✖ ${res.error}`
            : "—"}
        </Box>
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={() => copy(res?.json)}
            disabled={!res?.ok}
          >
            Copy JSON
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      aria-labelledby="compare-title"
    >
      <DialogTitle id="compare-title">Compare models on this input</DialogTitle>
      <DialogContent dividers>
        {err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        )}

        <Grid container spacing={2}>
          <Grid item xs={12} md={4}>
            <Cell title={`Base (${baseTag})`} res={baseRes} />
          </Grid>
          <Grid item xs={12} md={4}>
            <Cell title="Ensemble (3×)" res={ensRes} />
          </Grid>
          <Grid item xs={12} md={4}>
            <Cell
              title={`Fine-tuned (${fineTag || "not set"})`}
              res={fineRes}
            />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions>
        <Stack direction="row" spacing={1} sx={{ width: "100%" }}>
          <Button
            onClick={runAll}
            startIcon={loading ? <CircularProgress size={16} /> : undefined}
            disabled={loading}
          >
            {loading ? "Running…" : "Run"}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose}>Close</Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

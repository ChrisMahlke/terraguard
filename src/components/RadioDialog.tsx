// src/components/RadioDialog.tsx
"use client";

import { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { type Report } from "../slices/reportsSlice";

export default function RadioDialog({
  open,
  onClose,
  report,
}: {
  open: boolean;
  onClose: () => void;
  report: Report | null;
}) {
  const [en, setEn] = useState("");
  const [es, setEs] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const gen = async () => {
    if (!report) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/radio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setEn(j.en || "");
      setEs(j.es || "");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    const payload = `RADIO — EN:
${en}

RADIO — ES:
${es}
`;
    try {
      await navigator.clipboard.writeText(payload);
    } catch {}
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="radio-title"
    >
      <DialogTitle id="radio-title">Radio phrasing (EN / ES)</DialogTitle>
      <DialogContent dividers>
        {!report && (
          <Typography variant="body2">No report selected.</Typography>
        )}
        {err && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {err}
          </Alert>
        )}

        <Stack spacing={2}>
          <TextField
            label="English (concise)"
            value={en}
            onChange={(e) => setEn(e.target.value)}
            multiline
            minRows={2}
          />
          <TextField
            label="Español (conciso)"
            value={es}
            onChange={(e) => setEs(e.target.value)}
            multiline
            minRows={2}
          />
          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            Both are editable before copying.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Stack direction="row" spacing={1} sx={{ width: "100%" }}>
          <Button
            onClick={gen}
            startIcon={
              loading ? <CircularProgress size={16} /> : <RecordVoiceOverIcon />
            }
            disabled={!report || loading}
          >
            {loading ? "Generating…" : "Generate"}
          </Button>
          <Button
            onClick={copy}
            startIcon={<ContentCopyIcon />}
            disabled={!en && !es}
          >
            Copy
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={onClose}>Close</Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

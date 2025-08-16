// src/components/SITREPDialog.tsx
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
  Typography,
  CircularProgress,
  Alert,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import SummarizeIcon from "@mui/icons-material/Summarize";
import { type Report } from "../slices/reportsSlice";

export default function SITREPDialog({
  open,
  onClose,
  selected,
}: {
  open: boolean;
  onClose: () => void;
  selected: Report[];
}) {
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const onGenerate = async () => {
    setLoading(true);
    setError(null);
    setText("");
    try {
      const r = await fetch("/api/sitrep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reports: selected }),
      });
      const j = await r.json();
      if (!r.ok || !j?.text) throw new Error(j?.error || `HTTP ${r.status}`);
      setText(String(j.text));
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {}
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="md"
      aria-labelledby="sitrep-title"
    >
      <DialogTitle id="sitrep-title">Generate SITREP</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 1, opacity: 0.8 }}>
          Creates a concise 6–8 line situation report from {selected.length}{" "}
          selected item(s).
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box
          component="pre"
          sx={{
            minHeight: 180,
            p: 1.5,
            borderRadius: 1,
            bgcolor: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            whiteSpace: "pre-wrap",
            fontSize: 14,
          }}
        >
          {text || (loading ? "Generating…" : "No SITREP generated yet.")}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Stack direction="row" spacing={1} sx={{ width: "100%" }}>
          <Button
            onClick={onGenerate}
            startIcon={
              loading ? <CircularProgress size={16} /> : <SummarizeIcon />
            }
            disabled={loading || selected.length === 0}
          >
            {loading ? "Generating…" : "Generate"}
          </Button>
          <Button
            onClick={copy}
            startIcon={<ContentCopyIcon />}
            disabled={!text}
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

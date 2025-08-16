// src/components/ICS213Dialog.tsx
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
import ArticleIcon from "@mui/icons-material/Article";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { type Report } from "../slices/reportsSlice";

export default function ICS213Dialog({
  open,
  onClose,
  report,
}: {
  open: boolean;
  onClose: () => void;
  report: Report | null;
}) {
  const [to, setTo] = useState("Operations");
  const [from, setFrom] = useState("Triage");
  const [subject, setSubject] = useState("General Message");
  const [message, setMessage] = useState("");
  const [approved, setApproved] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const generate = async () => {
    if (!report) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch("/api/ics213", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ report, to, from, subject }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setTo(j.to || to);
      setFrom(j.from || from);
      setSubject(j.subject || subject);
      setMessage(j.message || "");
      setApproved(j.approved_by || "");
      setDateTime(j.date_time || "");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    const payload = `ICS-213
To: ${to}
From: ${from}
Subject: ${subject}
Date/Time: ${dateTime}

Message:
${message}

Approved by: ${approved || "(pending)"}
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
      aria-labelledby="ics213-title"
    >
      <DialogTitle id="ics213-title">ICS-213 (General Message)</DialogTitle>
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
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
            <TextField
              label="From"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextField
              label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </Stack>

          <TextField
            label="Generated message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            multiline
            minRows={6}
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField
              label="Approved by"
              value={approved}
              onChange={(e) => setApproved(e.target.value)}
            />
            <TextField
              label="Date/Time"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
            />
          </Stack>

          <Typography variant="caption" sx={{ opacity: 0.8 }}>
            Tip: you can edit any field above before copying.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Stack direction="row" spacing={1} sx={{ width: "100%" }}>
          <Button
            onClick={generate}
            startIcon={
              loading ? <CircularProgress size={16} /> : <ArticleIcon />
            }
            disabled={!report || loading}
          >
            {loading ? "Generating…" : "Generate"}
          </Button>
          <Button
            onClick={copy}
            startIcon={<ContentCopyIcon />}
            disabled={!message}
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

// src/components/ICS214Dialog.tsx
"use client";

import { useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  TextField,
  Typography,
  Stack,
  Alert,
} from "@mui/material";

import type { Report } from "../slices/reportsSlice";

export type ICS214Meta = {
  incidentName: string;
  opPeriodStart: string; // ISO or empty; we'll show datetime-local inputs
  opPeriodEnd: string;
  unitName: string;
  preparedBy: string;
};

function pad(n: number) {
  return n < 10 ? `0${n}` : String(n);
}
function toLocalDatetimeInput(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // yyyy-MM-ddTHH:mm
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromLocalDatetimeInput(local: string) {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function buildActivityLine(r: Report) {
  const sev = r.severity ? r.severity.toUpperCase() : "UNKNOWN";
  const needs = (r.needs || []).join(", ");
  const loc = r.location_text || "Unspecified location";
  return `[${sev}] ${needs ? needs + " – " : ""}${loc}${
    r.notes ? ` — ${r.notes}` : ""
  }`;
}

function buildICS214Text(meta: ICS214Meta, reports: Report[]) {
  const lines: string[] = [];
  lines.push("ICS 214 – ACTIVITY LOG");
  lines.push(`Incident Name: ${meta.incidentName || ""}`);
  lines.push(
    `Operational Period: ${meta.opPeriodStart || ""} to ${
      meta.opPeriodEnd || ""
    }`
  );
  lines.push(`Unit Name/Designator: ${meta.unitName || ""}`);
  lines.push(`Prepared By: ${meta.preparedBy || ""}`);
  lines.push("");
  lines.push("Activity Log:");
  lines.push("Time\tActivity / Notes\tLocation");
  for (const r of reports) {
    const time = r.time_iso || "";
    const activity = buildActivityLine(r);
    const loc = r.location_text || "";
    lines.push(`${time}\t${activity}\t${loc}`);
  }
  lines.push("");
  lines.push("Remarks:");
  lines.push("");
  return lines.join("\n");
}

export default function ICS214Dialog({
  open,
  onClose,
  selected,
}: {
  open: boolean;
  onClose: () => void;
  selected: Report[];
}) {
  const now = new Date();
  const nowLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
    now.getDate()
  )}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const [meta, setMeta] = useState<ICS214Meta>({
    incidentName: "Terraguard Demo Incident",
    opPeriodStart: nowLocal,
    opPeriodEnd: nowLocal,
    unitName: "Field Ops",
    preparedBy: "Operator",
  });

  const printableRef = useRef<HTMLDivElement>(null);

  const text = useMemo(
    () =>
      buildICS214Text(
        {
          ...meta,
          opPeriodStart: fromLocalDatetimeInput(meta.opPeriodStart),
          opPeriodEnd: fromLocalDatetimeInput(meta.opPeriodEnd),
        },
        selected
      ),
    [meta, selected]
  );

  const onPrint = () => {
    // Open a simple print window with plain text (works fully offline)
    const w = window.open(
      "",
      "_blank",
      "noopener,noreferrer,width=800,height=900"
    );
    if (!w) return;
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    w.document.write(
      `<!doctype html><title>ICS-214</title><pre style="font: 14px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; padding: 24px;">${escaped}</pre>`
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const onDownload = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ICS-214-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      alert("ICS-214 copied to clipboard");
    } catch {
      alert("Copy failed");
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Generate ICS-214 (Activity Log)</DialogTitle>
      <DialogContent dividers>
        {selected.length === 0 && (
          <Alert severity="info" sx={{ mb: 2 }}>
            No reports selected. Close this dialog and select at least one
            report.
          </Alert>
        )}

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Metadata
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Incident Name"
                value={meta.incidentName}
                onChange={(e) =>
                  setMeta({ ...meta, incidentName: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Unit Name/Designator"
                value={meta.unitName}
                onChange={(e) => setMeta({ ...meta, unitName: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="datetime-local"
                label="Operational Period Start"
                value={meta.opPeriodStart}
                onChange={(e) =>
                  setMeta({ ...meta, opPeriodStart: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                type="datetime-local"
                label="Operational Period End"
                value={meta.opPeriodEnd}
                onChange={(e) =>
                  setMeta({ ...meta, opPeriodEnd: e.target.value })
                }
              />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="Prepared By"
                value={meta.preparedBy}
                onChange={(e) =>
                  setMeta({ ...meta, preparedBy: e.target.value })
                }
              />
            </Grid>
          </Grid>
        </Box>

        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Preview
          </Typography>
          <Box
            ref={printableRef}
            component="pre"
            sx={{
              p: 2,
              borderRadius: 1,
              bgcolor: "background.default",
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              fontSize: 14,
              whiteSpace: "pre-wrap",
              overflowX: "auto",
            }}
          >
            {text}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Stack direction="row" spacing={1} sx={{ px: 1, py: 1 }}>
          <Button onClick={onCopy}>Copy</Button>
          <Button onClick={onDownload}>Download .txt</Button>
          <Button
            onClick={onPrint}
            variant="contained"
            disabled={selected.length === 0}
          >
            Print
          </Button>
          <Button onClick={onClose}>Close</Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}

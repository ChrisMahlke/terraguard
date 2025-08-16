// src/components/ReportTriage.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  Paper,
  Chip,
  IconButton,
  Alert,
  Tooltip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Link,
  Collapse,
  Switch,
  FormControlLabel,
  Container,
} from "@mui/material";
import DeleteIcon from "@mui/icons-material/Delete";
import SaveIcon from "@mui/icons-material/Save";
import SummarizeIcon from "@mui/icons-material/Summarize";
import SelectAllIcon from "@mui/icons-material/TaskAlt";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import BoltIcon from "@mui/icons-material/Bolt";
import PhoneIcon from "@mui/icons-material/Call";
import PlaceIcon from "@mui/icons-material/Place";
import PlaylistAddIcon from "@mui/icons-material/PlaylistAdd";
import TerminalIcon from "@mui/icons-material/Terminal";
import InsightsIcon from "@mui/icons-material/Insights";
import ArticleIcon from "@mui/icons-material/Article";
import RecordVoiceOverIcon from "@mui/icons-material/RecordVoiceOver";
import CrisisAlertIcon from "@mui/icons-material/CrisisAlert";
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";

import { useDispatch, useSelector } from "react-redux";
import type { RootState } from "../lib/store";
import {
  extractReports,
  extractReportsEnsemble,
  removeReport,
  upsertReport,
  type Report,
  annotateReports,
} from "../slices/reportsSlice";
import { loadKnowledge } from "../slices/knowledgeSlice";
import ICS214Dialog from "./ICS214Dialog";
import SITREPDialog from "./SITREPDialog";
import ICS213Dialog from "./ICS213Dialog";
import RadioDialog from "./RadioDialog";
import CompareDialog from "./CompareDialog";

export default function ReportTriage() {
  const dispatch = useDispatch();
  const { items, status, error } = useSelector((s: RootState) => s.reports);
  const knowledgeStatus = useSelector((s: RootState) => s.knowledge.status);
  const modelKind = useSelector((s: RootState) => s.model.kind);
  const fineTag = useSelector((s: RootState) => s.model.fineTag);
  const baseTag = useSelector((s: RootState) => s.model.baseTag);

  const [text, setText] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [icsOpen, setIcsOpen] = useState(false);

  // New dialogs
  const [sitrepOpen, setSitrepOpen] = useState(false);
  const [ics213Open, setIcs213Open] = useState(false);
  const [radioOpen, setRadioOpen] = useState(false);
  const [activeReport, setActiveReport] = useState<Report | null>(null);

  // Compare dialog
  const [compareOpen, setCompareOpen] = useState(false);

  // Live console state (only used for explicit streaming demo)
  const [showConsole, setShowConsole] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [tokenCount, setTokenCount] = useState(0);
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const consoleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll console
  useEffect(() => {
    if (consoleRef.current)
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleLines]);

  // Load local knowledge once
  useEffect(() => {
    /* @ts-ignore */ dispatch(loadKnowledge());
  }, [dispatch]);

  // After extraction completes (non-stream path), annotate
  useEffect(() => {
    if (status === "succeeded") {
      /* @ts-ignore */ dispatch(annotateReports());
    }
  }, [status, dispatch]);

  const onExtract = (overrideText?: string) => {
    const t = (overrideText ?? text).trim();
    if (!t) return;

    if (modelKind === "ensemble") {
      // @ts-ignore
      dispatch(extractReportsEnsemble({ text: t, samples: 3 }));
      return;
    }

    if (modelKind === "fine" && fineTag) {
      // call base endpoint but pass the fine model tag
      // @ts-ignore
      dispatch(extractReports({ text: t, model: fineTag }));
      return;
    }

    if (showConsole) {
      extractWithStream(t, baseTag);
    } else {
      // @ts-ignore
      dispatch(extractReports({ text: t, model: baseTag }));
    }
  };

  const onLoadDemo = async () => {
    try {
      const res = await fetch("/data/demo_reports.txt", { cache: "no-store" });
      const demo = await res.text();
      setText(demo);
      onExtract(demo); // auto-extract
    } catch {
      alert("Could not load demo set.");
    }
  };

  const reRank = () => {
    /* @ts-ignore */ dispatch(annotateReports());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const selectAll = () => setSelectedIds(new Set(items.map((i) => i.id)));
  const clearSelection = () => setSelectedIds(new Set());
  const selected = useMemo(
    () => items.filter((i) => selectedIds.has(i.id)),
    [items, selectedIds]
  );

  // sorted by risk desc
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => (b.risk_score || 0) - (a.risk_score || 0)),
    [items]
  );

  // Streaming console path (optional demo)
  async function extractWithStream(t: string, modelTag: string) {
    try {
      setStreaming(true);
      setTokenCount(0);
      setConsoleLines([`→ contacting local model (${modelTag})…`]);

      const res = await fetch("/api/extract/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: t, model: modelTag }),
      });

      if (!res.ok || !res.body) {
        setConsoleLines((l) => [
          ...l,
          `✖ HTTP ${res.status} from /api/extract/stream`,
        ]);
        setStreaming(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

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
            if (j.type === "status" && j.message === "model_started") {
              setConsoleLines((l) => [...l, `✓ model connected (${j.base})`]);
            } else if (j.type === "token") {
              const s = String(j.value ?? "");
              if (s) {
                setTokenCount((c) => c + s.length);
                setConsoleLines((l) => [...l, s]);
              }
            } else if (j.type === "parsed") {
              const data = j.data as { reports: Report[] };
              setConsoleLines((l) => [...l, "✓ parsed JSON received"]);
              for (const rep of data.reports || []) {
                /* @ts-ignore */ dispatch(upsertReport(rep));
              }
              /* @ts-ignore */ dispatch(annotateReports());
            } else if (j.type === "error") {
              setConsoleLines((l) => [
                ...l,
                `✖ error: ${j.message || "unknown"}`,
              ]);
            } else if (j.type === "status" && j.message === "model_complete") {
              setConsoleLines((l) => [...l, "… generation complete"]);
            }
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e: any) {
      setConsoleLines((l) => [...l, `✖ ${String(e?.message || e)}`]);
    } finally {
      setStreaming(false);
    }
  }

  return (
    <Stack
      spacing={2}
      sx={{ p: 2, mt: { xs: 7, sm: 8 }, maxWidth: 1000, mx: "auto" }}
    >
      <Stack
        direction="row"
        alignItems="stretch"
        justifyContent="space-between"
        sx={{ gap: 1, flexWrap: "wrap" }}
      >
        <Typography
          variant="h5"
          component="h2"
          sx={{ flex: "1 1 220px", alignSelf: "center" }}
        >
          Report triage (offline)
        </Typography>

        {/* Action buttons — full width on mobile */}
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: "wrap", width: { xs: "100%", sm: "auto" } }}
        >
          <Box sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}>
            <Button onClick={onLoadDemo} startIcon={<PlaylistAddIcon />}>
              Load demo set
            </Button>
          </Box>
          <Box sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}>
            <Button
              onClick={() => setCompareOpen(true)}
              startIcon={<CompareArrowsIcon />}
            >
              Compare
            </Button>
          </Box>
          <Box sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}>
            <Button
              onClick={selectAll}
              startIcon={<SelectAllIcon />}
              disabled={items.length === 0}
            >
              Select all
            </Button>
          </Box>
          <Box sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}>
            <Button
              onClick={clearSelection}
              startIcon={<ClearAllIcon />}
              disabled={selectedIds.size === 0}
            >
              Clear
            </Button>
          </Box>
          <Box sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}>
            <Button
              onClick={reRank}
              startIcon={<BoltIcon />}
              disabled={items.length === 0 || knowledgeStatus === "loading"}
            >
              Rank & suggest
            </Button>
          </Box>
          <Box sx={{ flex: { xs: "1 1 100%", sm: "0 0 auto" } }}>
            <Button
              variant="contained"
              startIcon={<SummarizeIcon />}
              onClick={() => setIcsOpen(true)}
              disabled={selectedIds.size === 0}
            >
              ICS-214 ({selectedIds.size})
            </Button>
          </Box>
        </Stack>
      </Stack>

      <TextField
        label="Paste one or more incoming reports"
        placeholder='e.g. "Bridge on Pine St cracked, 2:15pm, 5 people trapped, need medical and rescue."'
        multiline
        minRows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputProps={{ "aria-label": "Incoming reports text area" }}
      />

      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        alignItems={{ xs: "stretch", sm: "center" }}
      >
        <Box sx={{ width: { xs: "100%", sm: "auto" } }}>
          <Button
            variant="contained"
            onClick={() => onExtract()}
            disabled={status === "loading" || streaming}
            startIcon={
              status === "loading" || streaming ? (
                <CircularProgress size={18} />
              ) : null
            }
          >
            {status === "loading" || streaming ? "Extracting…" : "Extract"}
          </Button>
        </Box>
        <Box sx={{ width: { xs: "100%", sm: "auto" } }}>
          <Button variant="text" onClick={() => setText("")}>
            Clear input
          </Button>
        </Box>

        {/* Console is optional demo; disabled when not using base */}
        <FormControlLabel
          control={
            <Switch
              checked={showConsole}
              onChange={(e) => setShowConsole(e.target.checked)}
              color="primary"
              disabled={modelKind !== "base"}
            />
          }
          label={
            <Stack direction="row" spacing={1} alignItems="center">
              <TerminalIcon fontSize="small" />
              <span>Show AI console</span>
            </Stack>
          }
          sx={{ ml: { xs: 0, sm: "auto" } }}
        />
        {error ? <Alert severity="error">{error}</Alert> : null}
      </Stack>

      {/* Live AI console (base only) */}
      <Collapse in={showConsole && modelKind === "base"}>
        <Paper
          variant="outlined"
          sx={{ p: 1.5, bgcolor: "background.default" }}
        >
          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 1 }}>
            <Typography variant="subtitle2">AI console (live)</Typography>
            <Chip size="small" label={streaming ? "Streaming…" : "Idle"} />
            <Chip size="small" label={`Tokens: ${tokenCount}`} />
          </Stack>
          <Box
            ref={consoleRef}
            component="pre"
            role="log"
            aria-live="polite"
            sx={{
              m: 0,
              p: 1,
              maxHeight: 220,
              overflow: "auto",
              fontFamily:
                "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
              fontSize: 12,
              whiteSpace: "pre-wrap",
              borderRadius: 1,
              bgcolor: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            {consoleLines.join("")}
          </Box>
        </Paper>
      </Collapse>

      <Divider />

      <Stack spacing={2}>
        {sortedItems.map((r) => (
          <ReportCard
            key={r.id}
            report={r}
            selected={selectedIds.has(r.id)}
            onToggle={() => toggleSelect(r.id)}
            onSave={(rep) => {
              /* @ts-ignore */ dispatch(upsertReport(rep));
              /* @ts-ignore */ dispatch(annotateReports());
            }}
            onRemove={() => {
              /* @ts-ignore */ dispatch(removeReport(r.id));
              setSelectedIds((prev) => {
                const n = new Set(prev);
                n.delete(r.id);
                return n;
              });
            }}
            onICS213={() => {
              setActiveReport(r);
              setIcs213Open(true);
            }}
            onRadio={() => {
              setActiveReport(r);
              setRadioOpen(true);
            }}
          />
        ))}
        {items.length === 0 && status !== "loading" && !streaming && (
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            No extracted reports yet. Paste text above, click{" "}
            <b>Load demo set</b>, or tap <b>Extract</b>.
          </Typography>
        )}
      </Stack>

      {/* Existing ICS-214 dialog */}
      <ICS214Dialog
        open={icsOpen}
        onClose={() => setIcsOpen(false)}
        selected={selected}
      />
      {/* New dialogs */}
      <SITREPDialog
        open={sitrepOpen}
        onClose={() => setSitrepOpen(false)}
        selected={selected}
      />
      <ICS213Dialog
        open={ics213Open}
        onClose={() => setIcs213Open(false)}
        report={activeReport}
      />
      <RadioDialog
        open={radioOpen}
        onClose={() => setRadioOpen(false)}
        report={activeReport}
      />
      <CompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        text={text}
      />
    </Stack>
  );
}

function ReportCard({
  report,
  selected,
  onToggle,
  onSave,
  onRemove,
  onICS213,
  onRadio,
}: {
  report: Report;
  selected: boolean;
  onToggle: () => void;
  onSave: (r: Report) => void;
  onRemove: () => void;
  onICS213: () => void;
  onRadio: () => void;
}) {
  const [draft, setDraft] = useState<Report>(report);

  const sevColor: Record<
    NonNullable<Report["severity"]>,
    "default" | "success" | "warning" | "error" | "info"
  > = {
    low: "info",
    moderate: "warning",
    high: "error",
    critical: "error",
  };
  const sevLabel = (s: Report["severity"]) =>
    s ? s[0].toUpperCase() + s.slice(1) : "unknown";
  const confPct = (n?: number) => (n != null ? Math.round(n * 100) : undefined);

  useEffect(() => {
    setDraft(report);
  }, [report]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", sm: "center" }}
          justifyContent="space-between"
        >
          <Stack direction="row" spacing={1} alignItems="center">
            <Checkbox
              checked={selected}
              onChange={onToggle}
              inputProps={{ "aria-label": "Select report for batch actions" }}
            />
            <Typography variant="subtitle1">Extracted report</Typography>
          </Stack>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ width: { xs: "100%", sm: "auto" } }}
          >
            {typeof draft.confidence_overall === "number" && (
              <Tooltip
                title={
                  `Confidence — overall: ${confPct(
                    draft.confidence_overall
                  )}%` +
                  (draft.confields
                    ? ` (loc ${confPct(
                        draft.confields.location_text
                      )}%, time ${confPct(
                        draft.confields.time_iso
                      )}%, sev ${confPct(
                        draft.confields.severity
                      )}%, needs ${confPct(draft.confields.needs)}%)`
                    : "")
                }
              >
                <Chip
                  size="small"
                  label={`Confidence ${confPct(draft.confidence_overall)}%`}
                  variant="outlined"
                />
              </Tooltip>
            )}

            {draft.risk_score != null && (
              <Tooltip title={`Risk score: ${draft.risk_score}`}>
                <Box sx={{ minWidth: 160, flex: { xs: 1, sm: "initial" } }}>
                  <Typography variant="caption" sx={{ opacity: 0.8 }}>
                    Risk
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={draft.risk_score}
                    sx={{
                      height: 8,
                      borderRadius: 1,
                      bgcolor: "rgba(255,255,255,0.08)",
                    }}
                  />
                </Box>
              </Tooltip>
            )}
            {draft.severity ? (
              <Chip
                label={sevLabel(draft.severity)}
                color={sevColor[draft.severity]}
                size="small"
              />
            ) : (
              <Chip label="Unscored" size="small" variant="outlined" />
            )}

            {/* Per-card actions */}
            <Tooltip title="ICS-213">
              <span>
                <IconButton aria-label="Generate ICS-213" onClick={onICS213}>
                  <ArticleIcon />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Radio (EN/ES)">
              <span>
                <IconButton
                  aria-label="Generate radio phrasing"
                  onClick={onRadio}
                >
                  <RecordVoiceOverIcon />
                </IconButton>
              </span>
            </Tooltip>

            <Box sx={{ ml: "auto" }}>
              <IconButton aria-label="Delete report" onClick={onRemove}>
                <DeleteIcon />
              </IconButton>
            </Box>
          </Stack>
        </Stack>

        <TextField
          label="Location (free text)"
          value={draft.location_text || ""}
          onChange={(e) =>
            setDraft({ ...draft, location_text: e.target.value || null })
          }
        />
        <TextField
          label="Time (ISO-8601)"
          placeholder="e.g., 2025-08-15T14:00:00-07:00"
          value={draft.time_iso || ""}
          onChange={(e) =>
            setDraft({ ...draft, time_iso: e.target.value || null })
          }
        />

        <FormControl>
          <InputLabel id={`sev-${draft.id}`}>Severity</InputLabel>
          <Select
            labelId={`sev-${draft.id}`}
            label="Severity"
            value={draft.severity || ""}
            onChange={(e) =>
              setDraft({
                ...draft,
                severity: (e.target.value as Report["severity"]) || null,
              })
            }
          >
            <MenuItem value="">Unknown</MenuItem>
            <MenuItem value="low">Low</MenuItem>
            <MenuItem value="moderate">Moderate</MenuItem>
            <MenuItem value="high">High</MenuItem>
            <MenuItem value="critical">Critical</MenuItem>
          </Select>
        </FormControl>

        <TextField
          label="Needs (comma-separated)"
          placeholder="medical, rescue, water"
          value={(draft.needs || []).join(", ")}
          onChange={(e) =>
            setDraft({
              ...draft,
              needs: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
        />
        <TextField
          label="Notes"
          multiline
          minRows={2}
          value={draft.notes || ""}
          onChange={(e) =>
            setDraft({ ...draft, notes: e.target.value || null })
          }
        />

        {Array.isArray(draft.suggestions) && draft.suggestions.length > 0 && (
          <Box sx={{ mt: 1 }}>
            <Typography variant="subtitle2" gutterBottom>
              Suggested destinations
            </Typography>
            <List dense>
              {draft.suggestions.map((s) => (
                <ListItem key={s.id} sx={{ px: 0 }}>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <PlaceIcon fontSize="small" />
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {s.name}
                        </Typography>
                        <Chip size="small" label={s.type} variant="outlined" />
                      </Stack>
                    }
                    secondary={
                      <Stack
                        direction="row"
                        spacing={2}
                        alignItems="center"
                        sx={{ mt: 0.5, flexWrap: "wrap", gap: 1 }}
                      >
                        {s.address && (
                          <Typography variant="caption">{s.address}</Typography>
                        )}
                        {s.phone && (
                          <Stack
                            direction="row"
                            spacing={0.5}
                            alignItems="center"
                          >
                            <PhoneIcon fontSize="inherit" />
                            <Link
                              href={`tel:${s.phone}`}
                              underline="hover"
                              color="inherit"
                            >
                              {s.phone}
                            </Link>
                          </Stack>
                        )}
                        {Array.isArray(s.capabilities) &&
                          s.capabilities
                            .slice(0, 4)
                            .map((cap) => (
                              <Chip
                                key={cap}
                                size="small"
                                label={cap}
                                variant="outlined"
                              />
                            ))}
                        {s.notes && (
                          <Typography variant="caption" sx={{ opacity: 0.8 }}>
                            • {s.notes}
                          </Typography>
                        )}
                      </Stack>
                    }
                    primaryTypographyProps={{ component: "div" }}
                    secondaryTypographyProps={{ component: "div" }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        )}

        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1}
          justifyContent="flex-end"
          sx={{ pt: 1 }}
        >
          <Box sx={{ width: { xs: "100%", sm: "auto" } }}>
            <Button
              variant="outlined"
              onClick={() => setDraft(report)}
              fullWidth
            >
              Reset
            </Button>
          </Box>
          <Box sx={{ width: { xs: "100%", sm: "auto" } }}>
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={() => onSave(draft)}
              fullWidth
            >
              Save
            </Button>
          </Box>
        </Stack>
      </Stack>
    </Paper>
  );
}

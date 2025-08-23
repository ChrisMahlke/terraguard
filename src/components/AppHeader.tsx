// src/components/AppHeader.tsx
"use client";

import {
  AppBar,
  Toolbar,
  Typography,
  Stack,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Link as MLink,
  Box,
} from "@mui/material";
import Link from "next/link";
import { useDispatch, useSelector } from "react-redux";
import type { RootState } from "../lib/store";
import { setKind, type ModelKind } from "../slices/modelSlice";

export default function AppHeader() {
  const dispatch = useDispatch();
  const kind = useSelector((s: RootState) => s.model.kind);

  const handleChange = (e: any) => {
    dispatch(setKind(e.target.value as ModelKind));
  };

  return (
    <AppBar
      position="fixed"
      elevation={0}
      color="default"
      sx={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}
    >
      <Toolbar sx={{ gap: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>
          <MLink component={Link} href="/" color="inherit" underline="none">
            Terraguard
          </MLink>
        </Typography>

        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <MLink
            component={Link}
            href="/eval"
            color="inherit"
            underline="hover"
          >
            Eval
          </MLink>
        </Stack>

        <Box sx={{ flex: 1 }} />

        <FormControl size="small" sx={{ minWidth: 190 }}>
          <InputLabel id="model-kind">Model</InputLabel>
          <Select
            labelId="model-kind"
            label="Model"
            value={kind}
            onChange={handleChange}
          >
            <MenuItem value="ensemble">Ensemble (robust, confidence)</MenuItem>
            <MenuItem value="base">Base (gpt-oss:20b)</MenuItem>
            <MenuItem value="fine">Fine-tuned (when ready)</MenuItem>
          </Select>
        </FormControl>
      </Toolbar>
    </AppBar>
  );
}

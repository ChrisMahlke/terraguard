// src/app/page.tsx
"use client";

import dynamic from "next/dynamic";
import { Box, Container, Toolbar } from "@mui/material";

// Render these only on the client to avoid SSR/Emotion style mismatches
const AppHeader = dynamic(() => import("../components/AppHeader"), {
  ssr: false,
});
const ReportTriage = dynamic(() => import("../components/ReportTriage"), {
  ssr: false,
});

export default function Page() {
  return (
    <>
      <AppHeader />
      <Toolbar /> {/* spacer for fixed AppBar */}
      <Container maxWidth="lg">
        <Box sx={{ mt: 1 }}>
          <ReportTriage />
        </Box>
      </Container>
    </>
  );
}

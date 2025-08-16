// src/app/providers.tsx
"use client";

import { Provider } from "react-redux";
import { store } from "../lib/store";

import {
  ThemeProvider,
  createTheme,
  CssBaseline,
  responsiveFontSizes,
} from "@mui/material";

let theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0B0F14", paper: "#121821" },
    text: { primary: "#FFFFFF", secondary: "#D6E2EA" },
    primary: { main: "#2D81FF" }, // strong contrast on dark
  },
  typography: {
    // Slightly larger base improves readability on small screens
    fontSize: 15,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          // Respect iOS safe areas
          paddingBottom: "env(safe-area-inset-bottom)",
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minWidth: 44,
          minHeight: 44,
          // Full width on phones for easy tapping
          "@media (max-width:600px)": { width: "100%" },
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          // larger tap target on mobile
          "@media (max-width:600px)": { padding: 12 },
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        fullWidth: true,
        margin: "normal",
      },
    },
    MuiFormControl: {
      defaultProps: {
        fullWidth: true,
        margin: "normal",
      },
    },
    MuiContainer: {
      styleOverrides: {
        root: {
          "@media (max-width:600px)": { paddingLeft: 12, paddingRight: 12 },
        },
      },
    },
  },
});

// Scale typography by breakpoint (keeps headings readable on mobile)
theme = responsiveFontSizes(theme, { factor: 2.7 });

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Provider store={store}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </Provider>
  );
}

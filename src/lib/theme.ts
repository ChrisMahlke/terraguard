"use client";
import { createTheme } from "@mui/material/styles";

// Dark, high-contrast base. White on near-black passes AAA for normal text.
// Adjust sparingly; validate with axe/Storybook later.
const theme = createTheme({
  palette: {
    mode: "dark",
    background: { default: "#0B0F14", paper: "#121821" },
    text: { primary: "#FFFFFF", secondary: "#D6E2EA" },
    primary: { main: "#2D81FF" }, // white text on this passes >=7:1
    secondary: { main: "#00C2A8" },
    error: { main: "#FF4D4D" },
    warning: { main: "#FFB020" },
    success: { main: "#1BD97B" },
    info: { main: "#4DB6FF" },
  },
  typography: {
    fontSize: 14, // larger base helps touch/AAA
    button: { textTransform: "none", fontWeight: 600 },
  },
  components: {
    MuiButtonBase: {
      defaultProps: { disableRipple: true }, // calmer motion
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          minWidth: 44, // touch target
          outlineOffset: 2,
        },
      },
    },
    MuiLink: {
      styleOverrides: {
        root: {
          outlineOffset: 2,
          textDecorationThickness: "0.12em",
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: `
        :root { color-scheme: dark; }
        *:focus-visible {
          outline: 3px solid #FFD166; /* strong focus ring */
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation: none !important; transition: none !important; }
        }
        /* Skip link */
        .skip-link {
          position: absolute; left: 8px; top: 8px; z-index: 10000;
          background: #121821; color: #fff; padding: 8px 12px; border-radius: 8px;
          transform: translateY(-200%); transition: transform .2s;
        }
        .skip-link:focus { transform: translateY(0); }
      `,
    },
  },
});

export default theme;

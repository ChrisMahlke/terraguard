// src/app/layout.tsx
import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import ReduxProvider from "./redux-provider";
import MUIProvider from "./mui-provider";

export const metadata: Metadata = {
  title: "Terraguard",
  description: "Offline disaster triage with open models",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <ReduxProvider>
            <MUIProvider>{children}</MUIProvider>
          </ReduxProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}

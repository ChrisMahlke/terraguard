// src/app/redux-provider.tsx
"use client";

import { Provider } from "react-redux";
import { ReactNode } from "react";
import { store } from "../lib/store";

export default function ReduxProvider({ children }: { children: ReactNode }) {
  return <Provider store={store}>{children}</Provider>;
}

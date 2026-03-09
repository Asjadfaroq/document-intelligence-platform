"use client";

import React from "react";
import { LanguageProvider } from "./components/LanguageProvider";
import { ToastProvider } from "./components/ToastProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <LanguageProvider>
      <ToastProvider>{children}</ToastProvider>
    </LanguageProvider>
  );
}


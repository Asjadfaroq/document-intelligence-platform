"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

type Locale = "en" | "ar";
type Direction = "ltr" | "rtl";

interface LanguageContextValue {
  locale: Locale;
  dir: Direction;
  toggleLocale: () => void;
  setLocale: (locale: Locale) => void;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(
  undefined,
);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  const dir: Direction = locale === "ar" ? "rtl" : "ltr";

  function setLocale(next: Locale) {
    setLocaleState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("locale", next);
    }
  }

  function toggleLocale() {
    setLocale(locale === "en" ? "ar" : "en");
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("locale") as Locale | null;
    if (stored === "en" || stored === "ar") {
      setLocaleState(stored);
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
      document.documentElement.dir = dir;
    }
  }, [locale, dir]);

  return (
    <LanguageContext.Provider value={{ locale, dir, toggleLocale, setLocale }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}


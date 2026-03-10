"use client";

import { useEffect } from "react";

/**
 * Locks body scroll when true (e.g. when mobile drawer is open).
 * Restores previous overflow on unmount or when lock becomes false.
 */
export function useLockBodyScroll(lock: boolean): void {
  useEffect(() => {
    if (!lock) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [lock]);
}

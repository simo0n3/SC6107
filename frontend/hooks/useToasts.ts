"use client";

import { useCallback, useMemo, useState } from "react";

type ToastTone = "sent" | "confirmed" | "failed";

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

export function useToasts(timeoutMs = 3500) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const pushToast = useCallback(
    (message: string, tone: ToastTone) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      const next = { id, message, tone };
      setItems((prev) => [...prev, next].slice(-4));

      window.setTimeout(() => {
        setItems((prev) => prev.filter((entry) => entry.id !== id));
      }, timeoutMs);
    },
    [timeoutMs],
  );

  return useMemo(
    () => ({
      toasts: items,
      pushToast,
    }),
    [items, pushToast],
  );
}

export type { ToastItem, ToastTone };

"use client";

import type { ToastItem } from "@/hooks/useToasts";

type Props = {
  items: ToastItem[];
};

export function ToastStack({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((item) => (
        <div key={item.id} className={`toast ${item.tone}`}>
          {item.message}
        </div>
      ))}
    </div>
  );
}

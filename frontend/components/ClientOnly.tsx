"use client";

import { ReactNode, useSyncExternalStore } from "react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
};

export function ClientOnly({ children, fallback = null }: Props) {
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  if (!isClient) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}


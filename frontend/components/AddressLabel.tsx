"use client";

import { isAddress } from "ethers";
import { useEffect, useMemo, useState } from "react";
import { resolveEns, type EnsLookupProvider } from "@/lib/ens";
import { shortAddress } from "@/lib/utils";

type Props = {
  address: string;
  className?: string;
  copyable?: boolean;
  provider?: EnsLookupProvider | null;
  onCopied?: () => void;
};

export function AddressLabel({ address, className, copyable = true, provider = null, onCopied }: Props) {
  const fallback = useMemo(() => (isAddress(address) ? shortAddress(address) : "-"), [address]);
  const [resolved, setResolved] = useState<{ address: string; name: string | null }>({
    address: "",
    name: null,
  });
  const label = useMemo(() => {
    if (!isAddress(address)) return fallback;
    return resolved.address.toLowerCase() === address.toLowerCase() && resolved.name ? resolved.name : fallback;
  }, [address, fallback, resolved.address, resolved.name]);

  useEffect(() => {
    let active = true;

    if (!isAddress(address)) return () => {
      active = false;
    };

    void resolveEns(address, provider).then((name) => {
      if (!active) return;
      setResolved({ address, name });
    });

    return () => {
      active = false;
    };
  }, [address, provider]);

  async function copyAddress() {
    if (!copyable || !isAddress(address) || typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(address);
      onCopied?.();
    } catch {
      // ignore clipboard errors
    }
  }

  const classes = `address-label ${className ?? ""}`.trim();

  if (!copyable || !isAddress(address)) {
    return (
      <span className={classes} title={isAddress(address) ? address : undefined}>
        {label}
      </span>
    );
  }

  return (
    <button type="button" className={classes} title={`Copy ${address}`} onClick={() => void copyAddress()}>
      {label}
    </button>
  );
}

"use client";

import Link from "next/link";
import { shortAddress } from "@/lib/utils";
import { SEPOLIA_CHAIN_ID } from "@/lib/config";

type Props = {
  address: string;
  chainId: number | null;
  hasProvider: boolean;
  isSepolia: boolean;
  onConnect: () => Promise<void>;
};

export function AppHeader({ address, chainId, hasProvider, isSepolia, onConnect }: Props) {
  return (
    <header className="app-header">
      <div className="brand">
        <p className="eyebrow">SC6107 Option 4</p>
        <h1>Provably Fair Arcade</h1>
      </div>

      <nav className="nav-links">
        <Link href="/">Overview</Link>
        <Link href="/dice">Dice</Link>
        <Link href="/lottery">Lottery</Link>
      </nav>

      <div className="wallet">
        {!hasProvider && <span className="tag warning">MetaMask not detected</span>}
        {hasProvider && !address && (
          <button type="button" onClick={() => void onConnect()}>
            Connect MetaMask
          </button>
        )}
        {address && (
          <>
            <span className={`tag ${isSepolia ? "ok" : "warning"}`}>
              {isSepolia ? "Sepolia" : `Wrong network (${chainId ?? "?"})`}
            </span>
            <span className="tag">{shortAddress(address)}</span>
          </>
        )}
        {chainId !== null && chainId !== SEPOLIA_CHAIN_ID && <span className="hint">Please switch to Sepolia.</span>}
      </div>
    </header>
  );
}


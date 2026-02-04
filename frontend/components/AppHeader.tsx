"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();

  function linkClass(href: string): string {
    return pathname === href ? "pill good" : "pill";
  }

  return (
    <header className="topbar">
      <div className="brand">
        <p className="brand-label">SC6107 Option 4</p>
        <h1 className="top-title">Provably Fair Arcade</h1>
      </div>

      <nav className="top-nav" aria-label="Main navigation">
        <Link href="/" className={linkClass("/")}>
          Lobby
        </Link>
        <Link href="/dice" className={linkClass("/dice")}>
          Dice
        </Link>
        <Link href="/lottery" className={linkClass("/lottery")}>
          Lottery
        </Link>
      </nav>

      <div className="wallet-group">
        {!hasProvider && <span className="pill warn">MetaMask not detected</span>}
        {hasProvider && !address && (
          <button className="btn" type="button" onClick={() => void onConnect()}>
            Connect MetaMask
          </button>
        )}
        {address && (
          <>
            <span className={`pill ${isSepolia ? "good" : "warn"}`}>
              {isSepolia ? "Sepolia" : `Wrong network (${chainId ?? "?"})`}
            </span>
            <span className="pill mono">{shortAddress(address)}</span>
          </>
        )}
        {chainId !== null && chainId !== SEPOLIA_CHAIN_ID && (
          <span className="pill warn">Wrong network: switch to Sepolia</span>
        )}
      </div>
    </header>
  );
}

"use client";

import { BrowserProvider, Contract, isAddress } from "ethers";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AddressLabel } from "@/components/AddressLabel";
import { achievementNftAbi } from "@/lib/abis";
import { ADDRESSES, SEPOLIA_CHAIN_ID } from "@/lib/config";

type Props = {
  address: string;
  chainId: number | null;
  provider: BrowserProvider | null;
  hasProvider: boolean;
  isSepolia: boolean;
  onConnect: () => Promise<void>;
  onAddressCopied?: () => void;
};

export function AppHeader({ address, chainId, provider, hasProvider, isSepolia, onConnect, onAddressCopied }: Props) {
  const pathname = usePathname();
  const [hasAchievement, setHasAchievement] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadAchievement() {
      if (!provider || !address || !isSepolia || !isAddress(ADDRESSES.achievementNft)) {
        if (active) setHasAchievement(false);
        return;
      }

      try {
        const nft = new Contract(ADDRESSES.achievementNft, achievementNftAbi, provider);
        let unlocked = false;

        try {
          unlocked = Boolean(await nft.hasAchievement(address));
        } catch {
          const balance = await nft.balanceOf(address);
          unlocked = balance > 0n;
        }

        if (active) setHasAchievement(unlocked);
      } catch {
        if (active) setHasAchievement(false);
      }
    }

    void loadAchievement();

    return () => {
      active = false;
    };
  }, [provider, address, isSepolia]);

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
            <AddressLabel address={address} provider={provider} className="pill mono" onCopied={onAddressCopied} />
            {hasAchievement && (
              <span className="achievement-badge" title="Achievement unlocked" aria-label="Achievement unlocked">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    d="M8.5 3.5h7l1 4.2a6 6 0 1 1-9 0l1-4.2Zm2.1 11.6L12 14.2l1.4.9-.4-1.6 1.3-1-1.6-.1L12 10.9l-.7 1.5-1.6.1 1.3 1-.4 1.6Z"
                    fill="currentColor"
                  />
                </svg>
              </span>
            )}
          </>
        )}
        {chainId !== null && chainId !== SEPOLIA_CHAIN_ID && (
          <span className="pill warn">Wrong network: switch to Sepolia</span>
        )}
      </div>
    </header>
  );
}

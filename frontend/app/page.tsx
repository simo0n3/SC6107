"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Contract, isAddress } from "ethers";
import { AppHeader } from "@/components/AppHeader";
import { ClientOnly } from "@/components/ClientOnly";
import { useWallet } from "@/hooks/useWallet";
import { ADDRESSES } from "@/lib/config";
import { diceGameAbi, lotteryGameAbi } from "@/lib/abis";
import { explorerTx, formatAmount, shortAddress } from "@/lib/utils";

type RecentResult = {
  id: string;
  game: "Dice" | "Lottery";
  outcome: string;
  atLabel: string;
  verifyTx: string;
  blockNumber: number;
};

export default function HomePage() {
  const wallet = useWallet();
  const [houseEdgeBps, setHouseEdgeBps] = useState(100);
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [statusText, setStatusText] = useState("Connect wallet to load live results.");

  const envReady = useMemo(
    () => isAddress(ADDRESSES.diceGame) && isAddress(ADDRESSES.lotteryGame) && isAddress(ADDRESSES.vrfRouter),
    [],
  );

  useEffect(() => {
    async function loadLobbyData() {
      if (!wallet.provider || !wallet.isSepolia || !envReady) return;

      try {
        const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.provider);
        const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);

        const [edgeRaw, latestBlock] = await Promise.all([dice.houseEdgeBps(), wallet.provider.getBlockNumber()]);
        setHouseEdgeBps(Number(edgeRaw));

        const fromBlock = Math.max(0, latestBlock - 200_000);
        const [diceSettled, diceFulfilled, lotteryFinalized, lotteryFulfilled] = await Promise.all([
          dice.queryFilter(dice.filters.BetSettled(), fromBlock, latestBlock),
          dice.queryFilter(dice.filters.DiceRandomFulfilled(), fromBlock, latestBlock),
          lottery.queryFilter(lottery.filters.LotteryFinalized(), fromBlock, latestBlock),
          lottery.queryFilter(lottery.filters.LotteryRandomFulfilled(), fromBlock, latestBlock),
        ]);

        const diceFulfillTx = new Map<string, string>();
        for (const event of diceFulfilled) {
          const args = (event as unknown as { args: { betId: bigint } }).args;
          diceFulfillTx.set(args.betId.toString(), event.transactionHash);
        }

        const lotteryFulfillTx = new Map<string, string>();
        for (const event of lotteryFulfilled) {
          const args = (event as unknown as { args: { drawId: bigint } }).args;
          lotteryFulfillTx.set(args.drawId.toString(), event.transactionHash);
        }

        const merged: Array<Omit<RecentResult, "atLabel">> = [];

        for (const event of diceSettled.slice(-8)) {
          const args = (event as unknown as { args: { betId: bigint; won: boolean; payoutAmount: bigint } }).args;
          const betId = args.betId.toString();
          const won = args.won;
          const payout = formatAmount(args.payoutAmount);
          merged.push({
            id: `dice-${betId}-${event.transactionHash}`,
            game: "Dice",
            outcome: won ? `Win · Receive ${payout}` : "Lose",
            verifyTx: diceFulfillTx.get(betId) ?? event.transactionHash,
            blockNumber: event.blockNumber,
          });
        }

        for (const event of lotteryFinalized.slice(-8)) {
          const args = (event as unknown as { args: { drawId: bigint; winner: string; winnerPayout: bigint } }).args;
          const drawId = args.drawId.toString();
          const winner = shortAddress(args.winner);
          const prize = formatAmount(args.winnerPayout);
          merged.push({
            id: `lottery-${drawId}-${event.transactionHash}`,
            game: "Lottery",
            outcome: `Winner ${winner} · Prize ${prize}`,
            verifyTx: lotteryFulfillTx.get(drawId) ?? event.transactionHash,
            blockNumber: event.blockNumber,
          });
        }

        merged.sort((a, b) => b.blockNumber - a.blockNumber);
        const top = merged.slice(0, 3);

        const withTime = await Promise.all(
          top.map(async (item) => {
            const block = await wallet.provider!.getBlock(item.blockNumber);
            const ts = block?.timestamp ?? 0;
            return {
              ...item,
              atLabel: ts > 0 ? new Date(ts * 1000).toLocaleString() : "-",
            };
          }),
        );

        setRecentResults(withTime);
        setStatusText(withTime.length > 0 ? "Latest on-chain outcomes." : "No recent outcomes yet.");
      } catch (err) {
        setStatusText(`Failed to load lobby data: ${(err as Error).message}`);
      }
    }

    void loadLobbyData();
  }, [wallet.provider, wallet.isSepolia, envReady]);

  return (
    <ClientOnly fallback={<main className="page-shell" />}>
      <main className="page-shell">
        <AppHeader
          address={wallet.address}
          chainId={wallet.chainId}
          hasProvider={wallet.hasProvider}
          isSepolia={wallet.isSepolia}
          onConnect={wallet.connect}
        />

        <section className="card">
          <h1 className="hero-title">On-Chain Verifiable Random Games</h1>
          <p className="hero-sub">Fair outcomes powered by Chainlink VRF on Sepolia.</p>
          <div className="cta-row">
            <Link className="btn" href="/dice">
              Play Dice
            </Link>
            <Link className="btn secondary" href="/lottery">
              Play Lottery
            </Link>
          </div>
          <div className="pill-row">
            <span className="pill">Network: Sepolia</span>
            <span className="pill">House edge: {houseEdgeBps / 100}%</span>
            <span className="pill good">Fairness: VRF Verified</span>
          </div>
          {!envReady && (
            <p className="helper">Missing contract addresses in `.env.local`. Set dice, lottery, and router addresses first.</p>
          )}
        </section>

        <section className="card">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h3>Recent Results</h3>
            <span className="helper">{statusText}</span>
          </div>
          <div className="result-list" style={{ marginTop: "12px" }}>
            {recentResults.length === 0 && <p className="helper">No results yet.</p>}
            {recentResults.map((item) => (
              <article key={item.id} className="result-item">
                <div className="result-main">
                  <div className="result-top">
                    <span className="pill">{item.game}</span>
                    <span>{item.outcome}</span>
                  </div>
                  <span className="helper">{item.atLabel}</span>
                </div>
                <a className="btn ghost" href={explorerTx(item.verifyTx)} target="_blank" rel="noreferrer">
                  Verify
                </a>
              </article>
            ))}
          </div>
        </section>
      </main>
    </ClientOnly>
  );
}

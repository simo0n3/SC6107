"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Contract, isAddress, parseUnits } from "ethers";
import { AddressLabel } from "@/components/AddressLabel";
import { AppHeader } from "@/components/AppHeader";
import { ClientOnly } from "@/components/ClientOnly";
import { ToastStack } from "@/components/ToastStack";
import { useToasts } from "@/hooks/useToasts";
import { useWallet } from "@/hooks/useWallet";
import { ADDRESSES } from "@/lib/config";
import { diceGameAbi, erc20Abi, lotteryGameAbi } from "@/lib/abis";
import { explorerTx, formatAmount } from "@/lib/utils";

type RecentResult = {
  id: string;
  game: "Dice" | "Lottery";
  outcome: string;
  winnerAddress: string;
  prize: string;
  atLabel: string;
  verifyTx: string;
  blockNumber: number;
};

export default function HomePage() {
  const wallet = useWallet();
  const { toasts, pushToast } = useToasts();
  const [houseEdgeBps, setHouseEdgeBps] = useState(100);
  const [recentResults, setRecentResults] = useState<RecentResult[]>([]);
  const [statusText, setStatusText] = useState("Connect wallet to load live results.");
  const [faucetBusy, setFaucetBusy] = useState(false);

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
          const payout = formatAmount(args.payoutAmount);
          merged.push({
            id: `dice-${betId}-${event.transactionHash}`,
            game: "Dice",
            outcome: args.won ? `Win | Receive ${payout}` : "Lose",
            winnerAddress: "",
            prize: "",
            verifyTx: diceFulfillTx.get(betId) ?? event.transactionHash,
            blockNumber: event.blockNumber,
          });
        }

        for (const event of lotteryFinalized.slice(-8)) {
          const args = (event as unknown as { args: { drawId: bigint; winner: string; winnerPayout: bigint } }).args;
          const drawId = args.drawId.toString();
          const prize = formatAmount(args.winnerPayout);
          merged.push({
            id: `lottery-${drawId}-${event.transactionHash}`,
            game: "Lottery",
            outcome: "Winner",
            winnerAddress: args.winner,
            prize,
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

  async function claimSc7Faucet() {
    if (!wallet.signer || !wallet.address) {
      pushToast("Connect wallet first.", "failed");
      return;
    }
    if (!wallet.isSepolia) {
      pushToast("Wrong network: switch to Sepolia.", "failed");
      return;
    }
    if (!isAddress(ADDRESSES.testToken)) {
      pushToast("SC7 token address is missing in .env.local.", "failed");
      return;
    }

    try {
      setFaucetBusy(true);
      const token = new Contract(ADDRESSES.testToken, erc20Abi, wallet.signer);
      const [decimalsRaw, symbol, beforeRaw] = await Promise.all([
        token.decimals(),
        token.symbol(),
        token.balanceOf(wallet.address),
      ]);
      const decimals = Number(decimalsRaw);
      const before = BigInt(beforeRaw.toString());

      const tx = await token.faucet();
      pushToast("Tx sent: SC7 faucet", "sent");
      await tx.wait();

      const afterRaw = await token.balanceOf(wallet.address);
      const after = BigInt(afterRaw.toString());
      const minted = after - before;
      const targetNet = parseUnits("100", decimals);

      if (minted > targetNet && isAddress(ADDRESSES.treasuryVault)) {
        const extra = minted - targetNet;
        try {
          const normalizeTx = await token.transfer(ADDRESSES.treasuryVault, extra);
          pushToast("Tx sent: normalize to +100", "sent");
          await normalizeTx.wait();
          pushToast(`Claimed 100 ${symbol}.`, "confirmed");
          return;
        } catch {
          pushToast(
            `Faucet succeeded but normalize step failed. You received ${formatAmount(minted, decimals, 2)} ${symbol}.`,
            "failed",
          );
          return;
        }
      }

      pushToast(`Claimed ${formatAmount(minted, decimals, 2)} ${symbol}.`, "confirmed");
    } catch (err) {
      const msg = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? "Faucet failed.";
      if (msg.includes("user rejected")) {
        pushToast("Transaction cancelled in wallet.", "failed");
      } else {
        pushToast(msg, "failed");
      }
    } finally {
      setFaucetBusy(false);
    }
  }

  return (
    <ClientOnly fallback={<main className="page-shell" />}>
      <main className="page-shell">
        <ToastStack items={toasts} />
        <AppHeader
          address={wallet.address}
          chainId={wallet.chainId}
          provider={wallet.provider}
          hasProvider={wallet.hasProvider}
          isSepolia={wallet.isSepolia}
          onConnect={wallet.connect}
          onAddressCopied={() => pushToast("Copied", "confirmed")}
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
                    {item.winnerAddress ? (
                      <span>
                        Winner{" "}
                        <AddressLabel
                          address={item.winnerAddress}
                          provider={wallet.provider}
                          className="mono"
                          onCopied={() => pushToast("Copied", "confirmed")}
                        />{" "}
                        | Prize{" "}
                        {item.prize}
                      </span>
                    ) : (
                      <span>{item.outcome}</span>
                    )}
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

        <section className="card">
          <div className="inline" style={{ justifyContent: "space-between" }}>
            <h3>SC7 Faucet</h3>
            <span className="pill">Net +100 SC7</span>
          </div>
          <p className="helper" style={{ marginTop: "8px" }}>
            Test helper: claim SC7 for this wallet.
          </p>
          <div className="cta-row">
            <button className="btn secondary" type="button" disabled={faucetBusy || !wallet.address || !wallet.isSepolia} onClick={() => void claimSc7Faucet()}>
              {faucetBusy ? "Waiting..." : "Claim 100 SC7"}
            </button>
          </div>
          <p className="helper">If the on-chain faucet dispenses more, the extra amount is auto-sent back to TreasuryVault.</p>
        </section>
      </main>
    </ClientOnly>
  );
}

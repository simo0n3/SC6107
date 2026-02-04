"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AbiCoder,
  Contract,
  Interface,
  ZeroAddress,
  hexlify,
  isAddress,
  keccak256,
  parseUnits,
  randomBytes,
} from "ethers";
import { AppHeader } from "@/components/AppHeader";
import { ClientOnly } from "@/components/ClientOnly";
import { ToastStack } from "@/components/ToastStack";
import { useWallet } from "@/hooks/useWallet";
import { useToasts } from "@/hooks/useToasts";
import { ADDRESSES } from "@/lib/config";
import { diceGameAbi, erc20Abi, vrfRouterAbi } from "@/lib/abis";
import { explorerTx, formatAmount, isEthToken } from "@/lib/utils";

const BET_STATES = ["None", "Committed", "RandomRequested", "RandomFulfilled", "Settled", "Slashed", "Cancelled"];

type BetSnapshot = {
  betId: bigint;
  player: string;
  token: string;
  amount: bigint;
  maxPayout: bigint;
  rollUnder: number;
  revealDeadline: number;
  requestId: bigint;
  randomWord: bigint;
  state: number;
  roll: number | null;
  won: boolean | null;
  payoutAmount: bigint;
  fulfillTxHash: string;
  settleTxHash: string;
};

type VrfInfo = {
  subscriptionId: bigint;
  keyHash: string;
  callbackGasLimit: number;
};

const emptyBet: BetSnapshot = {
  betId: 0n,
  player: "",
  token: ZeroAddress,
  amount: 0n,
  maxPayout: 0n,
  rollUnder: 0,
  revealDeadline: 0,
  requestId: 0n,
  randomWord: 0n,
  state: 0,
  roll: null,
  won: null,
  payoutAmount: 0n,
  fulfillTxHash: "",
  settleTxHash: "",
};

function saltStorageKey(chainId: number, gameAddress: string, betId: bigint): string {
  return `dice-salt:${chainId}:${gameAddress.toLowerCase()}:${betId.toString()}`;
}

function parseError(err: unknown): string {
  const msg = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? "Failed.";
  if (msg.includes("user rejected")) return "Transaction cancelled in wallet.";
  if (msg.includes("No valid salt")) return "Missing bet secret. Open debug mode (?debug=1) and paste your salt.";
  if (msg.includes("CALL_EXCEPTION")) return "This action is not available for the current bet state.";
  return msg;
}

export default function DicePage() {
  const wallet = useWallet();
  const { toasts, pushToast } = useToasts();

  const [tokenChoice, setTokenChoice] = useState<"ETH" | "ERC20">("ETH");
  const [amountInput, setAmountInput] = useState("0.01");
  const [rollUnderInput, setRollUnderInput] = useState("49");
  const [latestBet, setLatestBet] = useState<BetSnapshot>(emptyBet);
  const [tokenSymbol, setTokenSymbol] = useState("SC7");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [houseEdgeBps, setHouseEdgeBps] = useState(100);
  const [statusText, setStatusText] = useState("Place a bet to start.");
  const [errorText, setErrorText] = useState("");
  const [busyAction, setBusyAction] = useState<"place" | "reveal" | "refresh" | "cancel" | "slash" | "none">("none");
  const [debugBetIdInput, setDebugBetIdInput] = useState("");
  const [manualSalt, setManualSalt] = useState("");
  const [vrfInfo, setVrfInfo] = useState<VrfInfo | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const diceReady = isAddress(ADDRESSES.diceGame);
  const tokenReady = isAddress(ADDRESSES.testToken);
  const routerReady = isAddress(ADDRESSES.vrfRouter);
  const canTransact = wallet.signer && wallet.isSepolia && diceReady;
  const showDebug = debugMode || isOwner;

  const selectedTokenAddress = tokenChoice === "ETH" ? ZeroAddress : ADDRESSES.testToken;

  const winChance = useMemo(() => {
    const parsed = Number(rollUnderInput);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 99) return 0;
    return parsed;
  }, [rollUnderInput]);

  const expectedPayout = useMemo(() => {
    try {
      const decimals = tokenChoice === "ETH" ? 18 : tokenDecimals;
      const amountWei = parseUnits(amountInput || "0", decimals);
      if (amountWei <= 0n || winChance <= 0) return 0n;
      const numerator = amountWei * BigInt(10_000 - houseEdgeBps) * 100n;
      const denominator = BigInt(winChance) * 10_000n;
      return numerator / denominator;
    } catch {
      return 0n;
    }
  }, [amountInput, tokenChoice, tokenDecimals, winChance, houseEdgeBps]);

  const progressionStep = useMemo(() => {
    if (latestBet.state === 0) return 0;
    if (latestBet.state === 1) return 1;
    if (latestBet.state === 2 || latestBet.state === 3) return 2;
    return 3;
  }, [latestBet.state]);

  const nowSec = Math.floor(Date.now() / 1000);
  const roundStatus: "Waiting" | "Ready" | "Result" = useMemo(() => {
    if (latestBet.state === 2) return "Waiting";
    if (latestBet.state === 3 && nowSec <= latestBet.revealDeadline) return "Ready";
    if (latestBet.state >= 4 || latestBet.state === 3) return "Result";
    return "Waiting";
  }, [latestBet.state, latestBet.revealDeadline, nowSec]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    setDebugMode(query.get("debug") === "1");
  }, []);

  useEffect(() => {
    async function bootstrap() {
      if (!wallet.provider || !diceReady) return;
      try {
        const diceRead = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.provider);
        const edge = await diceRead.houseEdgeBps();
        setHouseEdgeBps(Number(edge));

        if (wallet.address) {
          const owner = await diceRead.owner();
          setIsOwner(owner.toLowerCase() === wallet.address.toLowerCase());
        } else {
          setIsOwner(false);
        }
      } catch {
        // no-op
      }
    }

    async function loadTokenMeta() {
      if (!wallet.provider || !tokenReady) return;
      try {
        const token = new Contract(ADDRESSES.testToken, erc20Abi, wallet.provider);
        const [decimals, symbol] = await Promise.all([token.decimals(), token.symbol()]);
        setTokenDecimals(Number(decimals));
        setTokenSymbol(symbol);
      } catch {
        setTokenDecimals(18);
        setTokenSymbol("SC7");
      }
    }

    async function loadVrf() {
      if (!wallet.provider || !routerReady || !wallet.isSepolia) return;
      try {
        const router = new Contract(ADDRESSES.vrfRouter, vrfRouterAbi, wallet.provider);
        const cfg = await router.getVrfConfig();
        setVrfInfo({
          subscriptionId: cfg[1],
          keyHash: cfg[2],
          callbackGasLimit: Number(cfg[4]),
        });
      } catch {
        setVrfInfo(null);
      }
    }

    void bootstrap();
    void loadTokenMeta();
    void loadVrf();
  }, [wallet.provider, wallet.address, wallet.isSepolia, diceReady, tokenReady, routerReady]);

  const loadBetById = useCallback(async (betId: bigint) => {
    if (!wallet.provider || !diceReady || betId <= 0n) return;

    const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.provider);
    const data = await dice.bets(betId);
    const latestBlock = await wallet.provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 200_000);

    const [fulfilledEvents, settledEvents] = await Promise.all([
      dice.queryFilter(dice.filters.DiceRandomFulfilled(betId), fromBlock, latestBlock),
      dice.queryFilter(dice.filters.BetSettled(betId), fromBlock, latestBlock),
    ]);

    const settled =
      settledEvents.length > 0
        ? (settledEvents[settledEvents.length - 1] as unknown as {
            args: { roll: bigint; won: boolean; payoutAmount: bigint };
            transactionHash: string;
          })
        : null;

    setLatestBet({
      betId,
      player: data.player,
      token: data.token,
      amount: data.amount,
      maxPayout: data.maxPayout,
      rollUnder: Number(data.rollUnder),
      revealDeadline: Number(data.revealDeadline),
      requestId: data.requestId,
      randomWord: data.randomWord,
      state: Number(data.state),
      roll: settled ? Number(settled.args.roll) : null,
      won: settled ? Boolean(settled.args.won) : null,
      payoutAmount: settled ? (settled.args.payoutAmount as bigint) : 0n,
      fulfillTxHash: fulfilledEvents.length > 0 ? fulfilledEvents[fulfilledEvents.length - 1].transactionHash : "",
      settleTxHash: settled ? settled.transactionHash : "",
    });
    setStatusText(`Loaded bet #${betId.toString()}.`);
    setErrorText("");
  }, [wallet.provider, diceReady]);

  useEffect(() => {
    async function loadLatestBetForPlayer() {
      if (!wallet.provider || !wallet.address || !wallet.isSepolia || !diceReady) return;

      try {
        const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.provider);
        const latestBlock = await wallet.provider.getBlockNumber();
        const fromBlock = Math.max(0, latestBlock - 200_000);
        const commits = await dice.queryFilter(dice.filters.BetCommitted(null, wallet.address, null), fromBlock, latestBlock);
        if (commits.length === 0) return;

        commits.sort((a, b) => {
          if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
          return 0;
        });

        const betId = (commits[commits.length - 1] as unknown as { args: { betId: bigint } }).args.betId;
        setDebugBetIdInput(betId.toString());
        await loadBetById(betId);
      } catch {
        // keep quiet in auto load
      }
    }

    void loadLatestBetForPlayer();
  }, [wallet.provider, wallet.address, wallet.isSepolia, diceReady, loadBetById]);

  async function placeBet() {
    if (!canTransact || !wallet.address || !wallet.chainId) return;
    if (tokenChoice === "ERC20" && !tokenReady) {
      setErrorText("SC7 token address is missing in environment config.");
      return;
    }

    try {
      setBusyAction("place");
      setErrorText("");
      const rollUnder = Number(rollUnderInput);
      const decimals = tokenChoice === "ETH" ? 18 : tokenDecimals;
      const amountWei = parseUnits(amountInput, decimals);

      if (amountWei <= 0n) throw new Error("Amount must be greater than zero.");
      if (!Number.isInteger(rollUnder) || rollUnder < 1 || rollUnder > 99) {
        throw new Error("Win chance must be between 1% and 99%.");
      }

      const saltHex = hexlify(randomBytes(32));
      const encoder = AbiCoder.defaultAbiCoder();
      const commitHash = keccak256(
        encoder.encode(
          ["address", "address", "uint96", "uint8", "bytes32", "uint256", "address"],
          [wallet.address, selectedTokenAddress, amountWei, rollUnder, saltHex, BigInt(wallet.chainId), ADDRESSES.diceGame],
        ),
      );

      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.signer);
      if (!isEthToken(selectedTokenAddress)) {
        const token = new Contract(ADDRESSES.testToken, erc20Abi, wallet.signer);
        const allowance = await token.allowance(wallet.address, ADDRESSES.diceGame);
        if (allowance < amountWei) {
          const approveTx = await token.approve(ADDRESSES.diceGame, amountWei);
          pushToast(`Tx sent: approve ${tokenSymbol}`, "sent");
          await approveTx.wait();
          pushToast("Approval confirmed.", "confirmed");
        }
      }

      const tx = await dice.commitBet(selectedTokenAddress, amountWei, rollUnder, commitHash, {
        value: isEthToken(selectedTokenAddress) ? amountWei : 0n,
      });
      pushToast("Tx sent: Place Bet", "sent");
      const receipt = await tx.wait();
      pushToast("Bet placed and randomness requested.", "confirmed");

      const iface = new Interface(diceGameAbi);
      let betId = 0n;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "BetCommitted") {
            betId = parsed.args.betId as bigint;
          }
        } catch {
          // ignore unrelated logs
        }
      }

      if (betId > 0n) {
        localStorage.setItem(saltStorageKey(wallet.chainId, ADDRESSES.diceGame, betId), saltHex);
        setDebugBetIdInput(betId.toString());
        await loadBetById(betId);
      }
      setStatusText("Bet placed. Waiting for randomness...");
    } catch (err) {
      const msg = parseError(err);
      setErrorText(msg);
      pushToast(`Failed: ${msg}`, "failed");
    } finally {
      setBusyAction("none");
    }
  }

  async function revealAndSettle(useManualSalt: boolean) {
    if (!canTransact || latestBet.betId <= 0n || !wallet.chainId) return;

    try {
      setBusyAction("reveal");
      setErrorText("");
      const storageSalt = localStorage.getItem(saltStorageKey(wallet.chainId, ADDRESSES.diceGame, latestBet.betId)) ?? "";
      const candidate = useManualSalt ? manualSalt.trim() : storageSalt;
      if (!candidate || !candidate.startsWith("0x") || candidate.length !== 66) {
        throw new Error("No valid salt found. Open debug mode and input manual salt.");
      }

      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.signer);
      const tx = await dice.revealAndSettle(latestBet.betId, candidate);
      pushToast("Tx sent: Reveal & Settle", "sent");
      await tx.wait();
      pushToast("Round settled.", "confirmed");
      await loadBetById(latestBet.betId);
      setStatusText("Round settled.");
    } catch (err) {
      const msg = parseError(err);
      setErrorText(msg);
      pushToast(`Failed: ${msg}`, "failed");
    } finally {
      setBusyAction("none");
    }
  }

  async function debugAction(action: "refresh" | "cancel" | "slash" | "load") {
    if (!canTransact) return;
    const betId = BigInt(debugBetIdInput || "0");
    if (betId <= 0n) return;

    try {
      setBusyAction(action === "load" ? "refresh" : action);
      setErrorText("");

      if (action === "load") {
        await loadBetById(betId);
        return;
      }

      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.signer);
      let txHash = "";
      if (action === "cancel") {
        const tx = await dice.cancelIfUnfulfilled(betId);
        txHash = tx.hash;
        pushToast("Tx sent: Cancel stale bet", "sent");
        await tx.wait();
      }
      if (action === "slash") {
        const tx = await dice.slashExpired(betId);
        txHash = tx.hash;
        pushToast("Tx sent: Slash expired", "sent");
        await tx.wait();
      }
      if (txHash) pushToast("Transaction confirmed.", "confirmed");
      await loadBetById(betId);
    } catch (err) {
      const msg = parseError(err);
      setErrorText(msg);
      pushToast(`Failed: ${msg}`, "failed");
    } finally {
      setBusyAction("none");
    }
  }

  const payoutSymbol = latestBet.token.toLowerCase() === ZeroAddress.toLowerCase() ? "ETH" : tokenSymbol;
  const statusClass = roundStatus.toLowerCase();

  return (
    <ClientOnly fallback={<main className="page-shell" />}>
      <main className="page-shell">
        <ToastStack items={toasts} />
        <AppHeader
          address={wallet.address}
          chainId={wallet.chainId}
          hasProvider={wallet.hasProvider}
          isSepolia={wallet.isSepolia}
          onConnect={wallet.connect}
        />

        <section className="grid-2">
          <article className="card">
            <h2>Bet Slip</h2>
            <p className="helper">Pick your token, amount, and win chance.</p>

            <div className="field-grid">
              <div className="field">
                <label>Token</label>
                <select value={tokenChoice} onChange={(e) => setTokenChoice(e.target.value as "ETH" | "ERC20")}>
                  <option value="ETH">ETH</option>
                  <option value="ERC20" disabled={!tokenReady}>
                    {tokenSymbol}
                  </option>
                </select>
              </div>
              <div className="field">
                <label>Amount</label>
                <input value={amountInput} onChange={(e) => setAmountInput(e.target.value)} placeholder="0.01" />
              </div>
            </div>

            <div className="field" style={{ marginTop: "12px" }}>
              <label>Win chance {winChance}%</label>
              <div className="slider-wrap">
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={Math.max(1, Math.min(99, winChance || 49))}
                  onChange={(e) => setRollUnderInput(e.target.value)}
                />
                <small className="helper">{winChance}% chance to win</small>
              </div>
            </div>

            <div className="number-grid">
              <div className="number-row">
                <small>If win, receive</small>
                <strong>
                  {expectedPayout > 0n
                    ? `${formatAmount(expectedPayout, tokenChoice === "ETH" ? 18 : tokenDecimals, 4)} ${tokenChoice === "ETH" ? "ETH" : tokenSymbol}`
                    : "-"}
                </strong>
                <small>Incl. principal · House edge {(houseEdgeBps / 100).toFixed(2)}%</small>
              </div>
            </div>

            <div style={{ marginTop: "12px" }}>
              <button className="btn" type="button" disabled={!canTransact || busyAction !== "none"} onClick={() => void placeBet()}>
                {busyAction === "place" ? "Waiting..." : "Place Bet"}
              </button>
            </div>

            {latestBet.betId > 0n && (
              <div className="progress">
                <small className="helper">Progress</small>
                <div className="progress-track">
                  <span className={`progress-step ${progressionStep >= 1 ? "active" : ""}`}>Placed</span>
                  <span className={`progress-step ${progressionStep >= 2 ? "active" : ""}`}>Randomness</span>
                  <span className={`progress-step ${progressionStep >= 3 ? "active" : ""}`}>Result</span>
                </div>
              </div>
            )}
          </article>

          <article className="card">
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <h2>Current Round</h2>
              <span className={`status-badge ${statusClass}`}>{roundStatus}</span>
            </div>
            <p className="helper">{latestBet.betId > 0n ? `Bet #${latestBet.betId.toString()}` : "No active round yet."}</p>

            {roundStatus === "Waiting" && (
              <div className="number-grid" style={{ marginTop: "16px" }}>
                <div className="number-row">
                  <div className="inline">
                    <span className="spinner" />
                    <span>Waiting for randomness...</span>
                  </div>
                </div>
              </div>
            )}

            {roundStatus === "Ready" && (
              <div style={{ marginTop: "14px" }}>
                <button
                  className="btn"
                  type="button"
                  disabled={!canTransact || busyAction !== "none"}
                  onClick={() => void revealAndSettle(false)}
                >
                  {busyAction === "reveal" ? "Waiting..." : "Reveal & Settle"}
                </button>
                <p className="helper" style={{ marginTop: "8px" }}>
                  Reveal deadline: {latestBet.revealDeadline ? new Date(latestBet.revealDeadline * 1000).toLocaleString() : "-"}
                </p>
              </div>
            )}

            {roundStatus === "Result" && (
              <div className="number-grid" style={{ marginTop: "12px" }}>
                <div className="number-row">
                  <small>Roll</small>
                  <strong>{latestBet.roll ?? "-"}</strong>
                </div>
                <div className="number-row">
                  <small>Outcome</small>
                  <strong>
                    {latestBet.state === 4
                      ? latestBet.won
                        ? "Win"
                        : "Lose"
                      : latestBet.state === 5
                        ? "Expired"
                        : latestBet.state === 6
                          ? "Refunded"
                          : "Pending"}
                  </strong>
                </div>
                <div className="number-row">
                  <small>Payout</small>
                  <strong>
                    {latestBet.state === 4 && latestBet.won
                      ? `+${formatAmount(latestBet.payoutAmount, latestBet.token === ZeroAddress ? 18 : tokenDecimals, 4)} ${payoutSymbol}`
                      : "0"}
                  </strong>
                </div>
              </div>
            )}

            <details className="verify">
              <summary>Verify fairness</summary>
              <div className="verify-body">
                {latestBet.fulfillTxHash ? (
                  <a href={explorerTx(latestBet.fulfillTxHash)} target="_blank" rel="noreferrer">
                    Fulfill Tx (Etherscan)
                  </a>
                ) : (
                  <span className="helper">Fulfill tx not available yet.</span>
                )}
              </div>
            </details>
          </article>
        </section>

        {showDebug && (
          <section className="card debug">
            <h3>Debug / Admin</h3>
            <p className="helper">Visible because `?debug=1` is set or wallet is contract owner.</p>
            <div className="field-grid">
              <div className="field">
                <label>Bet ID</label>
                <input value={debugBetIdInput} onChange={(e) => setDebugBetIdInput(e.target.value)} placeholder="e.g. 2" />
              </div>
              <div className="field">
                <label>Manual Salt</label>
                <input value={manualSalt} onChange={(e) => setManualSalt(e.target.value)} placeholder="0x... (66 chars)" className="mono" />
              </div>
            </div>
            <div className="cta-row">
              <button className="btn secondary" type="button" onClick={() => void debugAction("load")} disabled={busyAction !== "none"}>
                Load Bet
              </button>
              <button className="btn" type="button" onClick={() => void revealAndSettle(true)} disabled={busyAction !== "none"}>
                Reveal with Manual Salt
              </button>
              <button className="btn danger" type="button" onClick={() => void debugAction("cancel")} disabled={busyAction !== "none"}>
                Cancel If Stale
              </button>
              <button className="btn danger" type="button" onClick={() => void debugAction("slash")} disabled={busyAction !== "none"}>
                Slash Expired
              </button>
            </div>
            <div className="field-grid">
              <div className="field">
                <label>Bet state</label>
                <input readOnly value={BET_STATES[latestBet.state] ?? "Unknown"} />
              </div>
              <div className="field">
                <label>VRF subscription</label>
                <input readOnly value={vrfInfo?.subscriptionId?.toString() ?? "-"} className="mono" />
              </div>
              <div className="field">
                <label>Key hash</label>
                <input readOnly value={vrfInfo?.keyHash ?? "-"} className="mono" />
              </div>
              <div className="field">
                <label>Callback gas</label>
                <input readOnly value={vrfInfo?.callbackGasLimit?.toString() ?? "-"} className="mono" />
              </div>
            </div>
          </section>
        )}

        {errorText && <p className="helper" style={{ color: "#ff9aa8" }}>{errorText}</p>}
        {!errorText && <p className="helper">{statusText}</p>}
      </main>
    </ClientOnly>
  );
}

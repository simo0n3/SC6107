"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AbiCoder, Contract, Interface, ZeroAddress, isAddress, parseUnits } from "ethers";
import { AddressLabel } from "@/components/AddressLabel";
import { AppHeader } from "@/components/AppHeader";
import { ClientOnly } from "@/components/ClientOnly";
import { ToastStack } from "@/components/ToastStack";
import { useWallet } from "@/hooks/useWallet";
import { useToasts } from "@/hooks/useToasts";
import { ADDRESSES } from "@/lib/config";
import { erc20Abi, lotteryGameAbi } from "@/lib/abis";
import { explorerTx, formatAmount, isEthToken } from "@/lib/utils";

type DrawSnapshot = {
  drawId: bigint;
  token: string;
  ticketPrice: bigint;
  houseEdgeBps: number;
  startTime: number;
  endTime: number;
  status: number;
  requestId: bigint;
  winner: string;
  totalTickets: bigint;
  potAmount: bigint;
  winnerPayout: bigint;
  fulfillTxHash: string;
  finalizeTxHash: string;
};

type RecentDraw = {
  drawId: bigint;
  winner: string;
  prize: bigint;
  status: number;
  startTime: number;
  endTime: number;
  verifyTxHash: string;
};

const DRAW_STATUS = ["None", "Open", "RandomRequested", "RandomFulfilled", "Finalized", "RolledOver", "TimedOut"];

function isOngoingDraw(status: number, endTime: number, nowSec: number): boolean {
  return status === 1 && nowSec < endTime;
}

const emptyDraw: DrawSnapshot = {
  drawId: 0n,
  token: ZeroAddress,
  ticketPrice: 0n,
  houseEdgeBps: 0,
  startTime: 0,
  endTime: 0,
  status: 0,
  requestId: 0n,
  winner: "",
  totalTickets: 0n,
  potAmount: 0n,
  winnerPayout: 0n,
  fulfillTxHash: "",
  finalizeTxHash: "",
};

const abiCoder = AbiCoder.defaultAbiCoder();

function asHexData(value: unknown): string | null {
  if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) return value;
  return null;
}

function extractRevertData(err: unknown, message: string): string | null {
  const anyErr = err as {
    data?: unknown;
    error?: { data?: unknown };
    info?: { error?: { data?: unknown } };
    revert?: { data?: unknown };
  };
  const direct = [anyErr?.data, anyErr?.error?.data, anyErr?.info?.error?.data, anyErr?.revert?.data];

  for (const candidate of direct) {
    const parsed = asHexData(candidate);
    if (parsed) return parsed;
  }

  const fromMessage = message.match(/data="?((0x)[0-9a-fA-F]+)"?/i);
  if (fromMessage?.[1]) return fromMessage[1];
  return null;
}

function decodeCustomError(data: string): string | null {
  if (!data.startsWith("0x") || data.length < 10) return null;
  const selector = data.slice(0, 10).toLowerCase();
  const payload = `0x${data.slice(10)}`;

  try {
    const decodeTuple = <T,>(types: string[]): T => abiCoder.decode(types, payload) as unknown as T;

    switch (selector) {
      case "0x336f5b32": { // DrawNotStarted(uint256,uint256)
        const [startTs] = decodeTuple<[bigint, bigint]>(["uint256", "uint256"]);
        return `Draw not started yet. Start time: ${new Date(Number(startTs) * 1000).toLocaleString()}.`;
      }
      case "0xf7aea3c5": { // DrawNotEnded(uint256,uint256)
        const [endTs, nowTs] = decodeTuple<[bigint, bigint]>(["uint256", "uint256"]);
        if (nowTs < endTs) {
          return `Draw not ended yet. You can start after ${new Date(Number(endTs) * 1000).toLocaleString()}.`;
        }
        return "Draw already ended. Betting is closed for this draw.";
      }
      case "0xd6ec17e3": { // TooManyTickets(uint256,uint256)
        const [, maxAllowed] = decodeTuple<[bigint, bigint]>(["uint256", "uint256"]);
        return `Too many tickets in one order. Max per transaction is ${maxAllowed.toString()}.`;
      }
      case "0x675bb9d9": // DrawSoldOut(uint256,uint256)
        return "This draw is sold out. Please choose another draw.";
      case "0xd07e8976": { // InvalidState(uint8)
        const [state] = decodeTuple<[number]>(["uint8"]);
        return `Action unavailable: draw is in ${DRAW_STATUS[state] ?? `state #${state}`}.`;
      }
      case "0x725adb2b": { // FulfillmentWaitNotExceeded(uint256,uint256)
        const [eligibleAt] = decodeTuple<[bigint, bigint]>(["uint256", "uint256"]);
        return `Too early to timeout. You can retry after ${new Date(Number(eligibleAt) * 1000).toLocaleString()}.`;
      }
      case "0x55e3fc17": // NoRefundAvailable(uint256,address)
        return "No refund is available for this wallet in this draw.";
      case "0xba301997": // RefundAlreadyClaimed(uint256,address)
        return "Refund already claimed for this draw.";
      case "0xc480be2e": // InsufficientLiquidity(address,uint256,uint256)
        return "Vault liquidity is insufficient for this action right now.";
      case "0xe450d38c": // ERC20InsufficientBalance(address,uint256,uint256)
        return "SC7 balance is insufficient for this purchase.";
      case "0xfb8f41b2": // ERC20InsufficientAllowance(address,uint256,uint256)
        return "SC7 allowance is insufficient. Please approve again and retry.";
      case "0x2c5211c6": // InvalidAmount()
        return "Invalid amount (check ticket count, ticket price, token limits, and draw window).";
      case "0x6d963f88": // EthTransferFailed()
        return "ETH transfer failed. Please retry.";
      case "0xb8f70d8a": // NotWhitelistedGame(address)
        return "Lottery contract is not whitelisted in TreasuryVault.";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function parseError(err: unknown): string {
  const msg = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message ?? "Failed.";
  const revertData = extractRevertData(err, msg);
  if (revertData) {
    const decoded = decodeCustomError(revertData);
    if (decoded) return decoded;
  }

  if (msg.includes("user rejected")) return "Transaction cancelled in wallet.";
  if (msg.includes("insufficient funds")) return "Wallet ETH is insufficient for gas.";
  if (msg.includes("CALL_EXCEPTION")) return "This action is not available in the current draw state.";
  return msg;
}

function formatRemaining(totalSeconds: number): string {
  if (totalSeconds <= 0) return "00:00";
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function LotteryPage() {
  const wallet = useWallet();
  const { toasts, pushToast } = useToasts();

  const [currentDraw, setCurrentDraw] = useState<DrawSnapshot>(emptyDraw);
  const [recentDraws, setRecentDraws] = useState<RecentDraw[]>([]);
  const [tokenSymbol, setTokenSymbol] = useState("SC7");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [ticketCount, setTicketCount] = useState(1);
  const [statusText, setStatusText] = useState("Load a draw to start.");
  const [errorText, setErrorText] = useState("");
  const [busyAction, setBusyAction] = useState<"none" | "buy" | "start" | "finalize" | "timeout" | "refund" | "refresh" | "create">(
    "none",
  );
  const [isOwner, setIsOwner] = useState(false);

  const [createTokenChoice, setCreateTokenChoice] = useState<"ETH" | "ERC20">("ETH");
  const [createTicketPriceInput, setCreateTicketPriceInput] = useState("10");
  const [createEndMinutesInput, setCreateEndMinutesInput] = useState("5");
  const [debugMode, setDebugMode] = useState(false);

  const lotteryReady = isAddress(ADDRESSES.lotteryGame);
  const tokenReady = isAddress(ADDRESSES.testToken);
  const canTransact = wallet.signer && wallet.isSepolia && lotteryReady;
  const showDebug = debugMode || isOwner;
  const selectedDrawTokenIsEth = currentDraw.token.toLowerCase() === ZeroAddress.toLowerCase();
  const activeTokenSymbol = selectedDrawTokenIsEth ? "ETH" : tokenSymbol;

  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const countdownLabel = useMemo(() => {
    if (!currentDraw.endTime) return "-";
    return formatRemaining(currentDraw.endTime - nowSec);
  }, [currentDraw.endTime, nowSec]);
  const startsInLabel = useMemo(() => {
    if (!currentDraw.startTime) return "-";
    return formatRemaining(currentDraw.startTime - nowSec);
  }, [currentDraw.startTime, nowSec]);

  const isNotStarted = currentDraw.status === 1 && nowSec < currentDraw.startTime;
  const canBuy = currentDraw.status === 1 && nowSec >= currentDraw.startTime && nowSec < currentDraw.endTime;
  const canStart = currentDraw.status === 1 && nowSec >= currentDraw.endTime;
  const canFinalize = currentDraw.status === 3;
  const isWaitingRandomness = currentDraw.status === 2;
  const isFinalized = currentDraw.status === 4;
  const isTimedOut = currentDraw.status === 6;
  const ongoingDraws = useMemo(
    () => recentDraws.filter((row) => isOngoingDraw(row.status, row.endTime, nowSec)),
    [recentDraws, nowSec],
  );
  const finishedDraws = useMemo(
    () => recentDraws.filter((row) => !isOngoingDraw(row.status, row.endTime, nowSec)),
    [recentDraws, nowSec],
  );

  const currentBetHint = useMemo(() => {
    if (currentDraw.drawId <= 0n) return "";
    if (isNotStarted) return `Not started yet. Starts in ${startsInLabel}.`;
    if (canBuy) return "Betting is open now.";
    if (currentDraw.status === 1 && nowSec >= currentDraw.endTime) return "Betting closed. Draw has reached end time.";
    if (currentDraw.status === 2) return "Betting closed. Waiting for randomness.";
    if (currentDraw.status === 3) return "Betting closed. Ready to finalize.";
    if (currentDraw.status >= 4) return "This draw is finished. Pick an ongoing draw below.";
    return "";
  }, [canBuy, currentDraw.drawId, currentDraw.endTime, currentDraw.status, isNotStarted, nowSec, startsInLabel]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const query = new URLSearchParams(window.location.search);
    setDebugMode(query.get("debug") === "1");
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadDrawById = useCallback(async (drawId: bigint) => {
    if (!wallet.provider || !lotteryReady || drawId <= 0n) return;

    const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);
    const [info, prize, latestBlock] = await Promise.all([
      lottery.draws(drawId),
      lottery.getCurrentPrize(drawId),
      wallet.provider.getBlockNumber(),
    ]);
    const fromBlock = Math.max(0, latestBlock - 200_000);

    const [fulfilledEvents, finalizedEvents] = await Promise.all([
      lottery.queryFilter(lottery.filters.LotteryRandomFulfilled(drawId), fromBlock, latestBlock),
      lottery.queryFilter(lottery.filters.LotteryFinalized(drawId), fromBlock, latestBlock),
    ]);

    setCurrentDraw({
      drawId,
      token: info.token,
      ticketPrice: info.ticketPrice,
      houseEdgeBps: Number(info.houseEdgeBps),
      startTime: Number(info.startTime),
      endTime: Number(info.endTime),
      status: Number(info.status),
      requestId: info.requestId,
      winner: info.winner,
      totalTickets: info.totalTickets,
      potAmount: info.potAmount,
      winnerPayout: prize[1],
      fulfillTxHash: fulfilledEvents.length > 0 ? fulfilledEvents[fulfilledEvents.length - 1].transactionHash : "",
      finalizeTxHash: finalizedEvents.length > 0 ? finalizedEvents[finalizedEvents.length - 1].transactionHash : "",
    });

    setStatusText(`Loaded draw #${drawId.toString()}.`);
    setErrorText("");
  }, [wallet.provider, lotteryReady]);

  const loadRecentDraws = useCallback(async (latestDrawId: bigint) => {
    if (!wallet.provider || !lotteryReady || latestDrawId <= 0n) return;

    const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);
    const latestBlock = await wallet.provider.getBlockNumber();
    const fromBlock = Math.max(0, latestBlock - 200_000);

    const [fulfilledEvents, finalizedEvents] = await Promise.all([
      lottery.queryFilter(lottery.filters.LotteryRandomFulfilled(), fromBlock, latestBlock),
      lottery.queryFilter(lottery.filters.LotteryFinalized(), fromBlock, latestBlock),
    ]);

    const fulfillMap = new Map<string, string>();
    for (const event of fulfilledEvents) {
      const args = (event as unknown as { args: { drawId: bigint } }).args;
      fulfillMap.set(args.drawId.toString(), event.transactionHash);
    }

    const finalizedMap = new Map<string, { winner: string; prize: bigint }>();
    for (const event of finalizedEvents) {
      const args = (event as unknown as { args: { drawId: bigint; winner: string; winnerPayout: bigint } }).args;
      finalizedMap.set(args.drawId.toString(), {
        winner: args.winner,
        prize: args.winnerPayout,
      });
    }

    const rows: RecentDraw[] = [];
    const minDrawId = latestDrawId > 5n ? latestDrawId - 4n : 1n;
    for (let drawId = latestDrawId; drawId >= minDrawId; drawId--) {
      const info = await lottery.draws(drawId);
      const key = drawId.toString();
      const fin = finalizedMap.get(key);
      rows.push({
        drawId,
        winner: fin?.winner ?? info.winner,
        prize: fin?.prize ?? 0n,
        status: Number(info.status),
        startTime: Number(info.startTime),
        endTime: Number(info.endTime),
        verifyTxHash: fulfillMap.get(key) ?? "",
      });
      if (drawId === 1n) break;
    }
    setRecentDraws(rows);
  }, [wallet.provider, lotteryReady]);

  useEffect(() => {
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

    async function loadOwnerAndVrf() {
      if (!wallet.provider || !lotteryReady) return;
      try {
        const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);
        if (wallet.address) {
          const owner = await lottery.owner();
          setIsOwner(owner.toLowerCase() === wallet.address.toLowerCase());
        } else {
          setIsOwner(false);
        }
      } catch {
        setIsOwner(false);
      }
    }

    void loadTokenMeta();
    void loadOwnerAndVrf();
  }, [wallet.provider, wallet.address, lotteryReady, tokenReady]);

  useEffect(() => {
    async function bootstrapDraws() {
      if (!wallet.provider || !wallet.isSepolia || !lotteryReady) return;
      try {
        const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);
        const latestDrawId = await lottery.nextDrawId();
        if (latestDrawId === 0n) {
          setStatusText("No draws created yet.");
          return;
        }
        let preferredDrawId = latestDrawId;
        let inspected = 0;
        const nowTs = Math.floor(Date.now() / 1000);
        for (let drawId = latestDrawId; drawId > 0n && inspected < 20; drawId--) {
          const info = await lottery.draws(drawId);
          if (isOngoingDraw(Number(info.status), Number(info.endTime), nowTs)) {
            preferredDrawId = drawId;
            break;
          }
          inspected += 1;
          if (drawId === 1n) break;
        }

        await Promise.all([loadDrawById(preferredDrawId), loadRecentDraws(latestDrawId)]);
      } catch (err) {
        setStatusText(`Failed to load draws: ${(err as Error).message}`);
      }
    }

    void bootstrapDraws();
  }, [wallet.provider, wallet.isSepolia, lotteryReady, loadDrawById, loadRecentDraws]);

  async function runTx(action: "buy" | "start" | "finalize" | "timeout" | "refund", drawId: bigint) {
    if (!canTransact || drawId <= 0n) return;
    try {
      setBusyAction(action);
      setErrorText("");
      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.signer);

      if (action === "buy") {
        const info = await lottery.draws(drawId);
        const totalCost = BigInt(info.ticketPrice) * BigInt(ticketCount);
        const token = info.token as string;

        if (!isEthToken(token) && wallet.address) {
          const tokenContract = new Contract(token, erc20Abi, wallet.signer);
          const allowance = await tokenContract.allowance(wallet.address, ADDRESSES.lotteryGame);
          if (allowance < totalCost) {
            const approveTx = await tokenContract.approve(ADDRESSES.lotteryGame, totalCost);
            pushToast(`Tx sent: approve ${tokenSymbol}`, "sent");
            await approveTx.wait();
            pushToast("Approval confirmed.", "confirmed");
          }
        }

        const tx = await lottery.buyTickets(drawId, ticketCount, { value: isEthToken(token) ? totalCost : 0n });
        pushToast("Tx sent: Buy Tickets", "sent");
        await tx.wait();
        pushToast("Tickets purchased.", "confirmed");
      }

      if (action === "start") {
        const tx = await lottery.startDraw(drawId);
        pushToast("Tx sent: Start Draw", "sent");
        await tx.wait();
        pushToast("Draw started.", "confirmed");
      }

      if (action === "finalize") {
        const tx = await lottery.finalizeDraw(drawId);
        pushToast("Tx sent: Finalize", "sent");
        await tx.wait();
        pushToast("Draw finalized.", "confirmed");
      }

      if (action === "timeout") {
        const tx = await lottery.timeoutDraw(drawId);
        pushToast("Tx sent: Timeout Draw", "sent");
        await tx.wait();
        pushToast("Draw marked timed out.", "confirmed");
      }

      if (action === "refund") {
        const tx = await lottery.claimTimedOutRefund(drawId);
        pushToast("Tx sent: Claim Refund", "sent");
        await tx.wait();
        pushToast("Refund claimed.", "confirmed");
      }

      await Promise.all([loadDrawById(drawId), loadRecentDraws(drawId > 0n ? drawId : 1n)]);
    } catch (err) {
      const msg = parseError(err);
      setErrorText(msg);
      pushToast(`Failed: ${msg}`, "failed");
    } finally {
      setBusyAction("none");
    }
  }

  async function createDraw() {
    if (!canTransact) return;
    if (createTokenChoice === "ERC20" && !tokenReady) {
      setErrorText("SC7 token address is missing in environment config.");
      return;
    }

    try {
      setBusyAction("create");
      setErrorText("");
      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.signer);
      const token = createTokenChoice === "ETH" ? ZeroAddress : ADDRESSES.testToken;
      const decimals = createTokenChoice === "ETH" ? 18 : tokenDecimals;
      const ticketPrice = parseUnits(createTicketPriceInput, decimals);
      const houseEdge = 100;
      const endMinutes = Number(createEndMinutesInput);
      const nowTs = Math.floor(Date.now() / 1000);
      const endTime = nowTs + endMinutes * 60;

      const tx = await lottery.createDraw(token, ticketPrice, nowTs, endTime, houseEdge);
      pushToast("Tx sent: Create Draw", "sent");
      const receipt = await tx.wait();
      pushToast("Draw created.", "confirmed");

      const iface = new Interface(lotteryGameAbi);
      let newDrawId = 0n;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "DrawCreated") {
            newDrawId = parsed.args.drawId as bigint;
          }
        } catch {
          // ignore
        }
      }

      if (newDrawId > 0n) {
        await Promise.all([loadDrawById(newDrawId), loadRecentDraws(newDrawId)]);
      }
    } catch (err) {
      const msg = parseError(err);
      setErrorText(msg);
      pushToast(`Failed: ${msg}`, "failed");
    } finally {
      setBusyAction("none");
    }
  }

  function getOngoingLabel(row: RecentDraw): string {
    if (row.status === 1 && nowSec < row.startTime) return "Not Started";
    if (row.status === 1 && nowSec >= row.startTime && nowSec < row.endTime) return "Betting Open";
    return DRAW_STATUS[row.status] ?? "Unknown";
  }

  function getOngoingMeta(row: RecentDraw): string {
    if (row.status === 1 && nowSec < row.startTime) {
      return `Starts in ${formatRemaining(row.startTime - nowSec)}`;
    }
    if (row.status === 1 && nowSec < row.endTime) return "Betting open";
    return DRAW_STATUS[row.status] ?? "Unknown";
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
          <h2>How Lottery Works</h2>
          <p className="helper" style={{ marginTop: "8px" }}>
            Buy tickets before countdown ends. After draw closes, randomness picks one winner on-chain.
          </p>
          <div className="helper" style={{ marginTop: "10px", display: "grid", gap: "5px" }}>
            <span>1) Pick an open draw and set ticket count.</span>
            <span>2) Click Buy Tickets before the timer reaches 00:00.</span>
            <span>3) After close: Start Draw -&gt; wait randomness -&gt; Finalize.</span>
            <span>4) Winner receives jackpot minus 1% house edge.</span>
          </div>
        </section>

        <section className="card">
          <h2>Current Draw</h2>
          <div className="grid-2" style={{ marginTop: "12px" }}>
            <div>
              <small className="helper">Jackpot</small>
              <div className="kpi">
                {formatAmount(currentDraw.winnerPayout, selectedDrawTokenIsEth ? 18 : tokenDecimals, 4)} {activeTokenSymbol}
              </div>
              <small className="helper">
                Ticket price: {formatAmount(currentDraw.ticketPrice, selectedDrawTokenIsEth ? 18 : tokenDecimals, 4)} {activeTokenSymbol}
              </small>
            </div>
            <div>
              <small className="helper">Ends in</small>
              <div className="countdown">{countdownLabel}</div>
              <small className="helper">Draw #{currentDraw.drawId.toString()} | {DRAW_STATUS[currentDraw.status] ?? "Unknown"}</small>
            </div>
          </div>

          <div className="cta-row">
            <div className="stepper">
              <button type="button" onClick={() => setTicketCount((v) => Math.max(1, v - 1))}>
                -
              </button>
              <input value={ticketCount} onChange={(e) => setTicketCount(Math.max(1, Number(e.target.value) || 1))} />
              <button type="button" onClick={() => setTicketCount((v) => v + 1)}>
                +
              </button>
            </div>

            {canBuy && (
              <button className="btn" type="button" disabled={!canTransact || busyAction !== "none"} onClick={() => void runTx("buy", currentDraw.drawId)}>
                {busyAction === "buy" ? "Waiting..." : "Buy Tickets"}
              </button>
            )}

            {canStart && (
              <button className="btn" type="button" disabled={!canTransact || busyAction !== "none"} onClick={() => void runTx("start", currentDraw.drawId)}>
                {busyAction === "start" ? "Waiting..." : "Start Draw"}
              </button>
            )}

            {canFinalize && (
              <button className="btn" type="button" disabled={!canTransact || busyAction !== "none"} onClick={() => void runTx("finalize", currentDraw.drawId)}>
                {busyAction === "finalize" ? "Waiting..." : "Finalize"}
              </button>
            )}

            {isTimedOut && (
              <button className="btn secondary" type="button" disabled={!canTransact || busyAction !== "none"} onClick={() => void runTx("refund", currentDraw.drawId)}>
                {busyAction === "refund" ? "Waiting..." : "Claim Refund"}
              </button>
            )}
          </div>

          {currentBetHint && <p className="helper">{currentBetHint}</p>}

          {isWaitingRandomness && (
            <div className="inline" style={{ marginTop: "10px" }}>
              <span className="spinner" />
              <span className="helper">Waiting for randomness...</span>
            </div>
          )}

          {isFinalized && (
            <div className="number-grid" style={{ marginTop: "12px" }}>
              <div className="number-row">
                <small>Winner</small>
                <strong>
                  <AddressLabel
                    address={currentDraw.winner}
                    provider={wallet.provider}
                    className="mono"
                    onCopied={() => pushToast("Copied", "confirmed")}
                  />
                </strong>
              </div>
              <div className="number-row">
                <small>Prize</small>
                <strong>
                  {formatAmount(currentDraw.winnerPayout, selectedDrawTokenIsEth ? 18 : tokenDecimals, 4)} {activeTokenSymbol}
                </strong>
              </div>
            </div>
          )}

          <details className="verify">
            <summary>Verify fairness</summary>
            <div className="verify-body">
              {currentDraw.fulfillTxHash ? (
                <a href={explorerTx(currentDraw.fulfillTxHash)} target="_blank" rel="noreferrer">
                  Fulfill Tx (Etherscan)
                </a>
              ) : (
                <span className="helper">Fulfill tx not available yet.</span>
              )}
            </div>
          </details>
        </section>

        <section className="grid-2">
          <article className="card">
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <h3>Ongoing Draws</h3>
              <span className="pill good">{ongoingDraws.length}</span>
            </div>
            <p className="helper" style={{ marginTop: "8px" }}>
              Live rounds. Choose one, then buy tickets.
            </p>
            <div className="list" style={{ marginTop: "12px" }}>
              {ongoingDraws.length === 0 && <p className="helper">No live draws right now.</p>}
              {ongoingDraws.map((row) => (
                <article key={row.drawId.toString()} className={`list-row ${currentDraw.drawId === row.drawId ? "active" : ""}`}>
                  <div>
                    <div className="inline" style={{ justifyContent: "space-between" }}>
                      <strong>Draw #{row.drawId.toString()}</strong>
                      <span className="pill good">{getOngoingLabel(row)}</span>
                    </div>
                    <div className="list-meta">{getOngoingMeta(row)}</div>
                  </div>
                  <div className="inline">
                    <button className="btn secondary" type="button" onClick={() => void loadDrawById(row.drawId)} disabled={busyAction !== "none"}>
                      {currentDraw.drawId === row.drawId ? "Loaded" : "Load"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>

          <article className="card">
            <div className="inline" style={{ justifyContent: "space-between" }}>
              <h3>Finished Draws</h3>
              <span className="pill">{finishedDraws.length}</span>
            </div>
            <p className="helper" style={{ marginTop: "8px" }}>
              Closed rounds for result checking.
            </p>
            <div className="list" style={{ marginTop: "12px" }}>
              {finishedDraws.length === 0 && <p className="helper">No finished draws yet.</p>}
              {finishedDraws.map((row) => (
                <article key={row.drawId.toString()} className={`list-row ${currentDraw.drawId === row.drawId ? "active" : ""}`}>
                  <div>
                    <strong>Draw #{row.drawId.toString()}</strong>
                    <div className="list-meta">
                      {row.status === 4 ? (
                        <>
                          Winner{" "}
                          <AddressLabel
                            address={row.winner}
                            provider={wallet.provider}
                            className="mono"
                            onCopied={() => pushToast("Copied", "confirmed")}
                          />{" "}
                          | Prize{" "}
                          {formatAmount(row.prize, selectedDrawTokenIsEth ? 18 : tokenDecimals, 4)} {activeTokenSymbol}
                        </>
                      ) : row.status === 5 ? (
                        "No winner. Pot rolled over."
                      ) : row.status === 6 ? (
                        "Timed out. Refund available."
                      ) : row.status === 3 ? (
                        "Randomness received. Ready to finalize."
                      ) : row.status === 2 ? (
                        "Betting closed. Waiting for randomness."
                      ) : row.status === 1 && nowSec >= row.endTime ? (
                        "Betting closed. Waiting to start draw."
                      ) : (
                        DRAW_STATUS[row.status] ?? "Unknown"
                      )}
                    </div>
                  </div>
                  <div className="inline">
                    <button className="btn secondary" type="button" onClick={() => void loadDrawById(row.drawId)} disabled={busyAction !== "none"}>
                      {currentDraw.drawId === row.drawId ? "Loaded" : "Load"}
                    </button>
                    {row.verifyTxHash ? (
                      <a className="btn ghost" href={explorerTx(row.verifyTxHash)} target="_blank" rel="noreferrer">
                        Verify
                      </a>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          </article>
        </section>

        {showDebug && (
          <section className="card debug">
            <h3>Debug / Admin</h3>
            <p className="helper">Visible because `?debug=1` is set or wallet is contract owner.</p>

            <div className="field-grid">
              <div className="field">
                <label>Current draw</label>
                <input value={currentDraw.drawId.toString()} readOnly />
              </div>
              <div className="field">
                <label>Load / Operate</label>
                <div className="cta-row" style={{ marginTop: "0" }}>
                  <button
                    className="btn secondary"
                    type="button"
                    disabled={busyAction !== "none"}
                    onClick={() => {
                      const drawId = currentDraw.drawId;
                      if (drawId > 0n) void loadDrawById(drawId);
                    }}
                  >
                    Refresh
                  </button>
                  <button
                    className="btn danger"
                    type="button"
                    disabled={!canTransact || busyAction !== "none" || currentDraw.drawId <= 0n}
                    onClick={() => void runTx("timeout", currentDraw.drawId)}
                  >
                    Timeout Draw
                  </button>
                </div>
              </div>
            </div>

            <h4 style={{ marginTop: "8px" }}>Create Draw</h4>
            <div className="field-grid">
              <div className="field">
                <label>Token</label>
                <select value={createTokenChoice} onChange={(e) => setCreateTokenChoice(e.target.value as "ETH" | "ERC20")}>
                  <option value="ETH">ETH</option>
                  <option value="ERC20" disabled={!tokenReady}>
                    {tokenSymbol}
                  </option>
                </select>
              </div>
              <div className="field">
                <label>Ticket price</label>
                <input value={createTicketPriceInput} onChange={(e) => setCreateTicketPriceInput(e.target.value)} />
              </div>
              <div className="field">
                <label>End after (minutes)</label>
                <input value={createEndMinutesInput} onChange={(e) => setCreateEndMinutesInput(e.target.value)} />
              </div>
            </div>
            <div className="cta-row">
              <button className="btn" type="button" disabled={!canTransact || busyAction !== "none"} onClick={() => void createDraw()}>
                {busyAction === "create" ? "Waiting..." : "Create Draw"}
              </button>
            </div>
          </section>
        )}

        {errorText && <p className="helper" style={{ color: "#ff9aa8" }}>{errorText}</p>}
        {!errorText && <p className="helper">{statusText}</p>}
      </main>
    </ClientOnly>
  );
}

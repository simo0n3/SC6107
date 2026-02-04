"use client";

import { useEffect, useMemo, useState } from "react";
import { Contract, Interface, ZeroAddress, isAddress, parseUnits } from "ethers";
import { AppHeader } from "@/components/AppHeader";
import { ClientOnly } from "@/components/ClientOnly";
import { useWallet } from "@/hooks/useWallet";
import { ADDRESSES, SEPOLIA_EXPLORER } from "@/lib/config";
import { erc20Abi, lotteryGameAbi, vrfRouterAbi } from "@/lib/abis";
import { explorerTx, formatAmount, isEthToken, toDateTime } from "@/lib/utils";

const DRAW_STATUS = ["None", "Open", "RandomRequested", "RandomFulfilled", "Finalized", "RolledOver"];

type DrawSnapshot = {
  drawId: bigint;
  token: string;
  ticketPrice: bigint;
  houseEdgeBps: number;
  startTime: number;
  endTime: number;
  status: number;
  requestId: bigint;
  randomWord: bigint;
  winner: string;
  totalTickets: bigint;
  potAmount: bigint;
  grossPot: bigint;
  winnerPayout: bigint;
  houseTake: bigint;
  fulfillTxHash: string;
  finalizeTxHash: string;
};

type VrfInfo = {
  coordinator: string;
  subscriptionId: bigint;
  keyHash: string;
};

const emptyDraw: DrawSnapshot = {
  drawId: 0n,
  token: ZeroAddress,
  ticketPrice: 0n,
  houseEdgeBps: 0,
  startTime: 0,
  endTime: 0,
  status: 0,
  requestId: 0n,
  randomWord: 0n,
  winner: "",
  totalTickets: 0n,
  potAmount: 0n,
  grossPot: 0n,
  winnerPayout: 0n,
  houseTake: 0n,
  fulfillTxHash: "",
  finalizeTxHash: "",
};

export default function LotteryPage() {
  const wallet = useWallet();

  const [drawIdInput, setDrawIdInput] = useState("");
  const [ticketCountInput, setTicketCountInput] = useState("1");
  const [createTokenChoice, setCreateTokenChoice] = useState<"ETH" | "ERC20">("ETH");
  const [createTicketPriceInput, setCreateTicketPriceInput] = useState("0.005");
  const [createEndMinutesInput, setCreateEndMinutesInput] = useState("5");
  const [createHouseEdgeInput, setCreateHouseEdgeInput] = useState("100");
  const [tokenSymbol, setTokenSymbol] = useState("TOKEN");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [draw, setDraw] = useState<DrawSnapshot>(emptyDraw);
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState("");
  const [vrfInfo, setVrfInfo] = useState<VrfInfo | null>(null);

  const lotteryReady = isAddress(ADDRESSES.lotteryGame);
  const tokenReady = isAddress(ADDRESSES.testToken);
  const routerReady = isAddress(ADDRESSES.vrfRouter);
  const canTransact = wallet.signer && wallet.isSepolia && lotteryReady;

  const activeDrawId = useMemo(() => {
    if (drawIdInput.trim()) {
      try {
        return BigInt(drawIdInput.trim());
      } catch {
        return draw.drawId;
      }
    }
    return draw.drawId;
  }, [drawIdInput, draw.drawId]);

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
        setTokenSymbol("TOKEN");
      }
    }
    void loadTokenMeta();
  }, [wallet.provider, tokenReady]);

  useEffect(() => {
    async function loadVrfConfig() {
      if (!wallet.provider || !routerReady || !wallet.isSepolia) return;
      try {
        const router = new Contract(ADDRESSES.vrfRouter, vrfRouterAbi, wallet.provider);
        const cfg = await router.getVrfConfig();
        setVrfInfo({
          coordinator: cfg[0],
          subscriptionId: cfg[1],
          keyHash: cfg[2],
        });
      } catch {
        setVrfInfo(null);
      }
    }
    void loadVrfConfig();
  }, [wallet.provider, wallet.isSepolia, routerReady]);

  async function loadDrawById(drawId: bigint) {
    if (!wallet.provider || !lotteryReady || drawId <= 0n) return;
    try {
      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);
      const [info, prize, latestBlock] = await Promise.all([
        lottery.draws(drawId),
        lottery.getCurrentPrize(drawId),
        wallet.provider.getBlockNumber(),
      ]);
      const fromBlock = Math.max(0, latestBlock - 200_000);
      const fulfilledEvents = await lottery.queryFilter(
        lottery.filters.LotteryRandomFulfilled(drawId),
        fromBlock,
        latestBlock,
      );
      const finalizedEvents = await lottery.queryFilter(lottery.filters.LotteryFinalized(drawId), fromBlock, latestBlock);

      setDraw({
        drawId,
        token: info.token,
        ticketPrice: info.ticketPrice,
        houseEdgeBps: Number(info.houseEdgeBps),
        startTime: Number(info.startTime),
        endTime: Number(info.endTime),
        status: Number(info.status),
        requestId: info.requestId,
        randomWord: info.randomWord,
        winner: info.winner,
        totalTickets: info.totalTickets,
        potAmount: info.potAmount,
        grossPot: prize[0],
        winnerPayout: prize[1],
        houseTake: prize[2],
        fulfillTxHash: fulfilledEvents.length ? fulfilledEvents[fulfilledEvents.length - 1].transactionHash : "",
        finalizeTxHash: finalizedEvents.length ? finalizedEvents[finalizedEvents.length - 1].transactionHash : "",
      });
      setStatus(`Loaded draw #${drawId.toString()}.`);
      setError("");
    } catch (err) {
      setError(`Load draw failed: ${(err as Error).message}`);
    }
  }

  async function createDraw() {
    if (!canTransact) return;
    if (createTokenChoice === "ERC20" && !tokenReady) {
      setError("NEXT_PUBLIC_TEST_TOKEN is missing.");
      return;
    }

    try {
      setError("");
      const token = createTokenChoice === "ETH" ? ZeroAddress : ADDRESSES.testToken;
      const decimals = createTokenChoice === "ETH" ? 18 : tokenDecimals;
      const ticketPrice = parseUnits(createTicketPriceInput, decimals);
      const houseEdge = Number(createHouseEdgeInput);
      const endMinutes = Number(createEndMinutesInput);
      const nowTs = Math.floor(Date.now() / 1000);

      if (ticketPrice <= 0n) throw new Error("Ticket price must be positive.");
      if (!Number.isInteger(houseEdge) || houseEdge < 0 || houseEdge >= 10_000) {
        throw new Error("houseEdgeBps must be 0..9999.");
      }
      if (!Number.isInteger(endMinutes) || endMinutes <= 0) {
        throw new Error("End minutes must be positive.");
      }

      const startTime = nowTs;
      const endTime = nowTs + endMinutes * 60;

      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.signer);
      setStatus("Creating draw...");
      const tx = await lottery.createDraw(token, ticketPrice, startTime, endTime, houseEdge);
      const receipt = await tx.wait();

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
        setDrawIdInput(newDrawId.toString());
        await loadDrawById(newDrawId);
      }

      setStatus(`Draw created. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function buyTickets() {
    if (!canTransact || activeDrawId <= 0n || !wallet.address) return;
    try {
      setError("");
      const lotteryRead = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.provider);
      const info = await lotteryRead.draws(activeDrawId);
      const count = Number(ticketCountInput);
      if (!Number.isInteger(count) || count <= 0) throw new Error("Ticket count must be positive integer.");

      const totalCost = BigInt(info.ticketPrice) * BigInt(count);
      const token = info.token as string;

      if (!isEthToken(token)) {
        const tokenContract = new Contract(token, erc20Abi, wallet.signer);
        const allowance = await tokenContract.allowance(wallet.address, ADDRESSES.lotteryGame);
        if (allowance < totalCost) {
          setStatus("Approving ERC20 allowance...");
          const approveTx = await tokenContract.approve(ADDRESSES.lotteryGame, totalCost);
          await approveTx.wait();
        }
      }

      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.signer);
      setStatus("Buying tickets...");
      const tx = await lottery.buyTickets(activeDrawId, count, { value: isEthToken(token) ? totalCost : 0n });
      await tx.wait();
      await loadDrawById(activeDrawId);
      setStatus(`Tickets bought. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function startDraw() {
    if (!canTransact || activeDrawId <= 0n) return;
    try {
      setError("");
      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.signer);
      setStatus("Starting draw...");
      const tx = await lottery.startDraw(activeDrawId);
      await tx.wait();
      await loadDrawById(activeDrawId);
      setStatus(`Draw started. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function finalizeDraw() {
    if (!canTransact || activeDrawId <= 0n) return;
    try {
      setError("");
      const lottery = new Contract(ADDRESSES.lotteryGame, lotteryGameAbi, wallet.signer);
      setStatus("Finalizing draw...");
      const tx = await lottery.finalizeDraw(activeDrawId);
      await tx.wait();
      await loadDrawById(activeDrawId);
      setStatus(`Draw finalized. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function claimFaucet() {
    if (!canTransact || !tokenReady) return;
    try {
      setError("");
      const token = new Contract(ADDRESSES.testToken, erc20Abi, wallet.signer);
      setStatus("Claiming faucet token...");
      const tx = await token.faucet();
      await tx.wait();
      setStatus(`Faucet received. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <ClientOnly fallback={<main className="app-shell" />}>
      <main className="app-shell">
        <AppHeader
          address={wallet.address}
          chainId={wallet.chainId}
          hasProvider={wallet.hasProvider}
          isSepolia={wallet.isSepolia}
          onConnect={wallet.connect}
        />

        <section className="grid">
          <article className="card span-6">
            <h2>Create Draw</h2>
            <p>Owner-only call. Draw supports ETH or test ERC20.</p>
            <div className="form-grid">
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
                <input
                  value={createTicketPriceInput}
                  onChange={(e) => setCreateTicketPriceInput(e.target.value)}
                  placeholder="0.005"
                />
              </div>
              <div className="field">
                <label>End after (minutes)</label>
                <input value={createEndMinutesInput} onChange={(e) => setCreateEndMinutesInput(e.target.value)} />
              </div>
              <div className="field">
                <label>House edge (bps)</label>
                <input value={createHouseEdgeInput} onChange={(e) => setCreateHouseEdgeInput(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button type="button" disabled={!canTransact} onClick={() => void createDraw()}>
                Create Draw
              </button>
              <button
                className="secondary"
                type="button"
                disabled={!canTransact || !tokenReady}
                onClick={() => void claimFaucet()}
              >
                Claim {tokenSymbol} Faucet
              </button>
            </div>
          </article>

          <article className="card span-6">
            <h2>Operate Draw</h2>
            <p>Buy tickets and trigger start/finalize after end time.</p>
            <div className="form-grid">
              <div className="field">
                <label>Draw ID</label>
                <input value={drawIdInput} onChange={(e) => setDrawIdInput(e.target.value)} placeholder="e.g. 1" />
              </div>
              <div className="field">
                <label>Ticket count</label>
                <input value={ticketCountInput} onChange={(e) => setTicketCountInput(e.target.value)} />
              </div>
            </div>
            <div className="actions">
              <button className="secondary" type="button" onClick={() => void loadDrawById(activeDrawId)}>
                Refresh Draw
              </button>
              <button type="button" disabled={!canTransact} onClick={() => void buyTickets()}>
                Buy Tickets
              </button>
              <button type="button" disabled={!canTransact} onClick={() => void startDraw()}>
                Start Draw
              </button>
              <button type="button" disabled={!canTransact} onClick={() => void finalizeDraw()}>
                Finalize Draw
              </button>
            </div>
          </article>

          <article className="card span-12">
            <div className="title-row">
              <h3>Draw Detail</h3>
              <span className="tag">{DRAW_STATUS[draw.status] ?? "Unknown"}</span>
            </div>
            <div className="kv">
              <span>Draw ID</span>
              <span>{draw.drawId.toString()}</span>
              <span>Token</span>
              <code>{draw.token}</code>
              <span>Ticket price</span>
              <span>
                {formatAmount(draw.ticketPrice, draw.token.toLowerCase() === ZeroAddress.toLowerCase() ? 18 : tokenDecimals)}{" "}
                {draw.token.toLowerCase() === ZeroAddress.toLowerCase() ? "ETH" : tokenSymbol}
              </span>
              <span>Total tickets</span>
              <span>{draw.totalTickets.toString()}</span>
              <span>Pot amount</span>
              <span>
                {formatAmount(draw.potAmount, draw.token.toLowerCase() === ZeroAddress.toLowerCase() ? 18 : tokenDecimals)}{" "}
                {draw.token.toLowerCase() === ZeroAddress.toLowerCase() ? "ETH" : tokenSymbol}
              </span>
              <span>Winner payout</span>
              <span>
                {formatAmount(draw.winnerPayout, draw.token.toLowerCase() === ZeroAddress.toLowerCase() ? 18 : tokenDecimals)}
              </span>
              <span>House take</span>
              <span>{formatAmount(draw.houseTake, draw.token.toLowerCase() === ZeroAddress.toLowerCase() ? 18 : tokenDecimals)}</span>
              <span>Start time</span>
              <span>{toDateTime(draw.startTime)}</span>
              <span>End time</span>
              <span>{toDateTime(draw.endTime)}</span>
              <span>Request ID</span>
              <code>{draw.requestId.toString()}</code>
              <span>Random word</span>
              <code>{draw.randomWord.toString()}</code>
              <span>Winner</span>
              <code>{draw.winner || "-"}</code>
              <span>Fulfill Tx</span>
              <span>
                {draw.fulfillTxHash ? (
                  <a href={explorerTx(draw.fulfillTxHash)} target="_blank" rel="noreferrer">
                    {draw.fulfillTxHash}
                  </a>
                ) : (
                  "-"
                )}
              </span>
              <span>Finalize Tx</span>
              <span>
                {draw.finalizeTxHash ? (
                  <a href={explorerTx(draw.finalizeTxHash)} target="_blank" rel="noreferrer">
                    {draw.finalizeTxHash}
                  </a>
                ) : (
                  "-"
                )}
              </span>
            </div>
          </article>

          <article className="card span-12">
            <h3>Verifiable Randomness Data</h3>
            <div className="kv">
              <span>Coordinator</span>
              <code>{vrfInfo?.coordinator ?? "-"}</code>
              <span>Subscription ID</span>
              <code>{vrfInfo?.subscriptionId.toString() ?? "-"}</code>
              <span>Key Hash</span>
              <code>{vrfInfo?.keyHash ?? "-"}</code>
              <span>Lottery address</span>
              <a href={`${SEPOLIA_EXPLORER}/address/${ADDRESSES.lotteryGame}`} target="_blank" rel="noreferrer">
                {ADDRESSES.lotteryGame || "-"}
              </a>
            </div>
          </article>
        </section>

        {error && <p className="status error">{error}</p>}
        {!error && <p className="status success">{status}</p>}
      </main>
    </ClientOnly>
  );
}

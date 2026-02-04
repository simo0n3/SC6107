"use client";

import { useEffect, useMemo, useState } from "react";
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
import { useWallet } from "@/hooks/useWallet";
import { ADDRESSES, SEPOLIA_EXPLORER } from "@/lib/config";
import { diceGameAbi, erc20Abi, vrfRouterAbi } from "@/lib/abis";
import { explorerTx, formatAmount, isEthToken, toDateTime } from "@/lib/utils";

const BET_STATES = ["None", "Committed", "RandomRequested", "RandomFulfilled", "Settled", "Slashed", "Cancelled"];

type BetSnapshot = {
  betId: bigint;
  player: string;
  token: string;
  amount: bigint;
  maxPayout: bigint;
  rollUnder: number;
  createdAt: number;
  requestedAt: number;
  revealDeadline: number;
  commitHash: string;
  requestId: bigint;
  randomWord: bigint;
  state: number;
  fulfillTxHash: string;
  settleTxHash: string;
};

type VrfInfo = {
  coordinator: string;
  subscriptionId: bigint;
  keyHash: string;
  requestConfirmations: number;
  callbackGasLimit: number;
};

const emptyBet: BetSnapshot = {
  betId: 0n,
  player: "",
  token: ZeroAddress,
  amount: 0n,
  maxPayout: 0n,
  rollUnder: 0,
  createdAt: 0,
  requestedAt: 0,
  revealDeadline: 0,
  commitHash: "",
  requestId: 0n,
  randomWord: 0n,
  state: 0,
  fulfillTxHash: "",
  settleTxHash: "",
};

function saltStorageKey(chainId: number, gameAddress: string, betId: bigint): string {
  return `dice-salt:${chainId}:${gameAddress.toLowerCase()}:${betId.toString()}`;
}

export default function DicePage() {
  const wallet = useWallet();
  const [tokenChoice, setTokenChoice] = useState<"ETH" | "ERC20">("ETH");
  const [amountInput, setAmountInput] = useState("0.01");
  const [rollUnderInput, setRollUnderInput] = useState("49");
  const [lookupBetIdInput, setLookupBetIdInput] = useState("");
  const [manualSalt, setManualSalt] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("TOKEN");
  const [tokenDecimals, setTokenDecimals] = useState(18);
  const [latestBet, setLatestBet] = useState<BetSnapshot>(emptyBet);
  const [status, setStatus] = useState("Ready.");
  const [error, setError] = useState("");
  const [vrfInfo, setVrfInfo] = useState<VrfInfo | null>(null);

  const diceReady = isAddress(ADDRESSES.diceGame);
  const routerReady = isAddress(ADDRESSES.vrfRouter);
  const tokenReady = isAddress(ADDRESSES.testToken);
  const selectedTokenAddress = tokenChoice === "ETH" ? ZeroAddress : ADDRESSES.testToken;

  const canTransact = wallet.signer && wallet.isSepolia && diceReady;
  const activeBetId = useMemo(() => {
    if (lookupBetIdInput.trim()) {
      try {
        return BigInt(lookupBetIdInput.trim());
      } catch {
        return latestBet.betId;
      }
    }
    return latestBet.betId;
  }, [lookupBetIdInput, latestBet.betId]);

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
          requestConfirmations: Number(cfg[3]),
          callbackGasLimit: Number(cfg[4]),
        });
      } catch {
        setVrfInfo(null);
      }
    }
    void loadVrfConfig();
  }, [wallet.provider, wallet.isSepolia, routerReady]);

  async function loadBetById(betId: bigint) {
    if (!wallet.provider || !diceReady || betId <= 0n) return;
    try {
      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.provider);
      const data = await dice.bets(betId);
      const latestBlock = await wallet.provider.getBlockNumber();
      const fromBlock = Math.max(0, latestBlock - 200_000);

      const fulfilledEvents = await dice.queryFilter(dice.filters.DiceRandomFulfilled(betId), fromBlock, latestBlock);
      const settledEvents = await dice.queryFilter(dice.filters.BetSettled(betId), fromBlock, latestBlock);

      setLatestBet({
        betId,
        player: data.player,
        token: data.token,
        amount: data.amount,
        maxPayout: data.maxPayout,
        rollUnder: Number(data.rollUnder),
        createdAt: Number(data.createdAt),
        requestedAt: Number(data.requestedAt),
        revealDeadline: Number(data.revealDeadline),
        commitHash: data.commitHash,
        requestId: data.requestId,
        randomWord: data.randomWord,
        state: Number(data.state),
        fulfillTxHash: fulfilledEvents.length ? fulfilledEvents[fulfilledEvents.length - 1].transactionHash : "",
        settleTxHash: settledEvents.length ? settledEvents[settledEvents.length - 1].transactionHash : "",
      });
      setStatus(`Loaded bet #${betId.toString()}.`);
      setError("");
    } catch (err) {
      setError(`Load bet failed: ${(err as Error).message}`);
    }
  }

  async function placeBet() {
    if (!canTransact || !wallet.address || !wallet.chainId) return;
    if (tokenChoice === "ERC20" && !tokenReady) {
      setError("NEXT_PUBLIC_TEST_TOKEN is missing.");
      return;
    }
    try {
      setError("");
      setStatus("Preparing commitment...");
      const rollUnder = Number(rollUnderInput);
      const decimals = tokenChoice === "ETH" ? 18 : tokenDecimals;
      const amountWei = parseUnits(amountInput, decimals);
      const limit = (1n << 96n) - 1n;
      if (amountWei <= 0n || amountWei > limit) {
        throw new Error("Amount out of uint96 range.");
      }
      if (!Number.isInteger(rollUnder) || rollUnder < 1 || rollUnder > 99) {
        throw new Error("rollUnder must be between 1 and 99.");
      }

      const saltBytes = randomBytes(32);
      const saltHex = hexlify(saltBytes);
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
          setStatus("Approving ERC20 allowance...");
          const approveTx = await token.approve(ADDRESSES.diceGame, amountWei);
          await approveTx.wait();
        }
      }

      setStatus("Submitting commitBet transaction...");
      const tx = await dice.commitBet(selectedTokenAddress, amountWei, rollUnder, commitHash, {
        value: isEthToken(selectedTokenAddress) ? amountWei : 0n,
      });
      const receipt = await tx.wait();
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
        setLookupBetIdInput(betId.toString());
        await loadBetById(betId);
      }

      setStatus(`Bet committed. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function revealBet() {
    if (!canTransact || activeBetId <= 0n || !wallet.chainId) return;
    try {
      setError("");
      const storageSalt = localStorage.getItem(saltStorageKey(wallet.chainId, ADDRESSES.diceGame, activeBetId)) ?? "";
      const salt = manualSalt.trim() || storageSalt;
      if (!salt || !salt.startsWith("0x") || salt.length !== 66) {
        throw new Error("No valid salt found. Use local salt or paste one manually.");
      }

      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.signer);
      setStatus(`Revealing bet #${activeBetId.toString()}...`);
      const tx = await dice.revealAndSettle(activeBetId, salt);
      await tx.wait();
      await loadBetById(activeBetId);
      setStatus(`Reveal complete. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function slashBet() {
    if (!canTransact || activeBetId <= 0n) return;
    try {
      setError("");
      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.signer);
      setStatus(`Slashing expired bet #${activeBetId.toString()}...`);
      const tx = await dice.slashExpired(activeBetId);
      await tx.wait();
      await loadBetById(activeBetId);
      setStatus(`Slashed. Tx: ${tx.hash}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function cancelBet() {
    if (!canTransact || activeBetId <= 0n) return;
    try {
      setError("");
      const dice = new Contract(ADDRESSES.diceGame, diceGameAbi, wallet.signer);
      setStatus(`Cancelling stale bet #${activeBetId.toString()}...`);
      const tx = await dice.cancelIfUnfulfilled(activeBetId);
      await tx.wait();
      await loadBetById(activeBetId);
      setStatus(`Cancelled. Tx: ${tx.hash}`);
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
            <h2>Place Dice Bet</h2>
            <p>One-click flow: commit + request randomness.</p>

            <div className="form-grid">
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
              <div className="field">
                <label>rollUnder (1-99)</label>
                <input value={rollUnderInput} onChange={(e) => setRollUnderInput(e.target.value)} placeholder="49" />
              </div>
              <div className="field">
                <label>Selected token address</label>
                <input value={selectedTokenAddress} readOnly className="mono" />
              </div>
            </div>

            <div className="actions">
              <button type="button" disabled={!canTransact} onClick={() => void placeBet()}>
                Commit + Request
              </button>
            </div>
          </article>

          <article className="card span-6">
            <h2>Manage Bet</h2>
            <p>Load by bet ID, then reveal/cancel/slash.</p>
            <div className="form-grid">
              <div className="field">
                <label>Bet ID</label>
                <input
                  value={lookupBetIdInput}
                  onChange={(e) => setLookupBetIdInput(e.target.value)}
                  placeholder="e.g. 1"
                />
              </div>
              <div className="field">
                <label>Manual Salt (optional)</label>
                <input
                  value={manualSalt}
                  onChange={(e) => setManualSalt(e.target.value)}
                  placeholder="0x... (66 chars)"
                  className="mono"
                />
              </div>
            </div>

            <div className="actions">
              <button className="secondary" type="button" onClick={() => void loadBetById(activeBetId)}>
                Refresh Bet
              </button>
              <button type="button" disabled={!canTransact} onClick={() => void revealBet()}>
                Reveal + Settle
              </button>
              <button className="warn" type="button" disabled={!canTransact} onClick={() => void cancelBet()}>
                Cancel If Stale
              </button>
              <button className="warn" type="button" disabled={!canTransact} onClick={() => void slashBet()}>
                Slash Expired
              </button>
            </div>
          </article>

          <article className="card span-12">
            <div className="title-row">
              <h3>Bet Detail</h3>
              <span className="tag">{BET_STATES[latestBet.state] ?? "Unknown"}</span>
            </div>
            <div className="kv">
              <span>Bet ID</span>
              <span>{latestBet.betId.toString()}</span>
              <span>Player</span>
              <code>{latestBet.player || "-"}</code>
              <span>Token</span>
              <code>{latestBet.token}</code>
              <span>Amount</span>
              <span>
                {formatAmount(
                  latestBet.amount,
                  latestBet.token.toLowerCase() === ZeroAddress.toLowerCase() ? 18 : tokenDecimals,
                )}{" "}
                {latestBet.token.toLowerCase() === ZeroAddress.toLowerCase() ? "ETH" : tokenSymbol}
              </span>
              <span>rollUnder</span>
              <span>{latestBet.rollUnder || "-"}</span>
              <span>Request ID</span>
              <code>{latestBet.requestId.toString()}</code>
              <span>Random Word</span>
              <code>{latestBet.randomWord.toString()}</code>
              <span>Reveal deadline</span>
              <span>{toDateTime(latestBet.revealDeadline)}</span>
              <span>Fulfill Tx</span>
              <span>
                {latestBet.fulfillTxHash ? (
                  <a href={explorerTx(latestBet.fulfillTxHash)} target="_blank" rel="noreferrer">
                    {latestBet.fulfillTxHash}
                  </a>
                ) : (
                  "-"
                )}
              </span>
              <span>Settle Tx</span>
              <span>
                {latestBet.settleTxHash ? (
                  <a href={explorerTx(latestBet.settleTxHash)} target="_blank" rel="noreferrer">
                    {latestBet.settleTxHash}
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
              <span>Request confirmations</span>
              <span>{vrfInfo?.requestConfirmations ?? "-"}</span>
              <span>Callback gas limit</span>
              <span>{vrfInfo?.callbackGasLimit ?? "-"}</span>
              <span>Dice address</span>
              <a href={`${SEPOLIA_EXPLORER}/address/${ADDRESSES.diceGame}`} target="_blank" rel="noreferrer">
                {ADDRESSES.diceGame || "-"}
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

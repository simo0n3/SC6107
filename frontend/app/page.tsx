"use client";

import { useEffect, useMemo, useState } from "react";
import { Contract, isAddress } from "ethers";
import { AppHeader } from "@/components/AppHeader";
import { ClientOnly } from "@/components/ClientOnly";
import { useWallet } from "@/hooks/useWallet";
import { ADDRESSES, LINK_TOKEN_SEPOLIA, SEPOLIA_EXPLORER } from "@/lib/config";
import { treasuryVaultAbi, vrfRouterAbi, erc20Abi } from "@/lib/abis";
import { formatAmount, shortAddress } from "@/lib/utils";

type VaultSnapshot = {
  ethTotal: bigint;
  ethReserved: bigint;
  ethFree: bigint;
  tokenTotal: bigint;
  tokenReserved: bigint;
  tokenFree: bigint;
  minEthBet: bigint;
  maxEthBet: bigint;
  minTokenBet: bigint;
  maxTokenBet: bigint;
  tokenSymbol: string;
};

type VrfSnapshot = {
  coordinator: string;
  subscriptionId: bigint;
  keyHash: string;
  requestConfirmations: number;
  callbackGasLimit: number;
  nativePayment: boolean;
};

const emptyVault: VaultSnapshot = {
  ethTotal: 0n,
  ethReserved: 0n,
  ethFree: 0n,
  tokenTotal: 0n,
  tokenReserved: 0n,
  tokenFree: 0n,
  minEthBet: 0n,
  maxEthBet: 0n,
  minTokenBet: 0n,
  maxTokenBet: 0n,
  tokenSymbol: "TOKEN",
};

export default function HomePage() {
  const wallet = useWallet();
  const [vaultData, setVaultData] = useState<VaultSnapshot>(emptyVault);
  const [vrfData, setVrfData] = useState<VrfSnapshot | null>(null);
  const [status, setStatus] = useState<string>("Connect wallet to read live state.");

  const envReady = useMemo(
    () =>
      isAddress(ADDRESSES.treasuryVault) &&
      isAddress(ADDRESSES.vrfRouter) &&
      isAddress(ADDRESSES.diceGame) &&
      isAddress(ADDRESSES.lotteryGame),
    [],
  );

  useEffect(() => {
    async function load() {
      if (!wallet.provider || !wallet.isSepolia || !envReady) return;
      try {
        const vault = new Contract(ADDRESSES.treasuryVault, treasuryVaultAbi, wallet.provider);
        const router = new Contract(ADDRESSES.vrfRouter, vrfRouterAbi, wallet.provider);

        const [ethBalances, ethLimits, vrfCfg] = await Promise.all([
          vault.getVaultBalances("0x0000000000000000000000000000000000000000"),
          vault.getTokenBetLimits("0x0000000000000000000000000000000000000000"),
          router.getVrfConfig(),
        ]);

        let tokenBalances = [0n, 0n, 0n] as const;
        let tokenLimits = [0n, 0n] as const;
        let tokenSymbol = "TOKEN";

        if (isAddress(ADDRESSES.testToken)) {
          const token = new Contract(ADDRESSES.testToken, erc20Abi, wallet.provider);
          [tokenBalances, tokenLimits, tokenSymbol] = await Promise.all([
            vault.getVaultBalances(ADDRESSES.testToken),
            vault.getTokenBetLimits(ADDRESSES.testToken),
            token.symbol(),
          ]);
        }

        setVaultData({
          ethTotal: ethBalances[0],
          ethReserved: ethBalances[1],
          ethFree: ethBalances[2],
          tokenTotal: tokenBalances[0],
          tokenReserved: tokenBalances[1],
          tokenFree: tokenBalances[2],
          minEthBet: ethLimits[0],
          maxEthBet: ethLimits[1],
          minTokenBet: tokenLimits[0],
          maxTokenBet: tokenLimits[1],
          tokenSymbol,
        });

        setVrfData({
          coordinator: vrfCfg[0],
          subscriptionId: vrfCfg[1],
          keyHash: vrfCfg[2],
          requestConfirmations: Number(vrfCfg[3]),
          callbackGasLimit: Number(vrfCfg[4]),
          nativePayment: vrfCfg[5],
        });

        setStatus("Live data loaded from Sepolia.");
      } catch (err) {
        setStatus(`Failed to load on-chain data: ${(err as Error).message}`);
      }
    }

    void load();
  }, [wallet.provider, wallet.isSepolia, envReady]);

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
          <article className="card span-12">
            <div className="title-row">
              <h2>Protocol Overview</h2>
              <span className="tag">MetaMask only</span>
            </div>
            <div className="kv">
              <span>Status</span>
              <span>{status}</span>
              <span>TreasuryVault</span>
              <code>{ADDRESSES.treasuryVault || "Missing NEXT_PUBLIC_TREASURY_VAULT"}</code>
              <span>VRFRouter</span>
              <code>{ADDRESSES.vrfRouter || "Missing NEXT_PUBLIC_VRF_ROUTER"}</code>
              <span>DiceGame</span>
              <code>{ADDRESSES.diceGame || "Missing NEXT_PUBLIC_DICE_GAME"}</code>
              <span>LotteryGame</span>
              <code>{ADDRESSES.lotteryGame || "Missing NEXT_PUBLIC_LOTTERY_GAME"}</code>
              <span>Test ERC20</span>
              <code>{ADDRESSES.testToken || "Optional: NEXT_PUBLIC_TEST_TOKEN"}</code>
              <span>Chainlink LINK (Sepolia)</span>
              <code>{LINK_TOKEN_SEPOLIA}</code>
            </div>
            {!envReady && <p className="status error">Please set contract addresses in `frontend/.env.local` first.</p>}
          </article>

          <article className="card span-6">
            <h3>Vault Balances</h3>
            <div className="kv">
              <span>ETH total</span>
              <span>{formatAmount(vaultData.ethTotal)} ETH</span>
              <span>ETH reserved</span>
              <span>{formatAmount(vaultData.ethReserved)} ETH</span>
              <span>ETH free</span>
              <span>{formatAmount(vaultData.ethFree)} ETH</span>
              <span>{vaultData.tokenSymbol} total</span>
              <span>{formatAmount(vaultData.tokenTotal)}</span>
              <span>{vaultData.tokenSymbol} reserved</span>
              <span>{formatAmount(vaultData.tokenReserved)}</span>
              <span>{vaultData.tokenSymbol} free</span>
              <span>{formatAmount(vaultData.tokenFree)}</span>
            </div>
          </article>

          <article className="card span-6">
            <h3>Global Bet Limits</h3>
            <div className="kv">
              <span>ETH min</span>
              <span>{formatAmount(vaultData.minEthBet)} ETH</span>
              <span>ETH max</span>
              <span>{formatAmount(vaultData.maxEthBet)} ETH</span>
              <span>{vaultData.tokenSymbol} min</span>
              <span>{formatAmount(vaultData.minTokenBet)}</span>
              <span>{vaultData.tokenSymbol} max</span>
              <span>{formatAmount(vaultData.maxTokenBet)}</span>
            </div>
          </article>

          <article className="card span-12">
            <div className="title-row">
              <h3>Verifiable Randomness Panel</h3>
              {vrfData?.coordinator && (
                <a
                  className="tag"
                  href={`${SEPOLIA_EXPLORER}/address/${vrfData.coordinator}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortAddress(vrfData.coordinator)}
                </a>
              )}
            </div>
            <div className="kv">
              <span>Coordinator</span>
              <code>{vrfData?.coordinator ?? "-"}</code>
              <span>Subscription ID</span>
              <code>{vrfData?.subscriptionId.toString() ?? "-"}</code>
              <span>Key Hash</span>
              <code>{vrfData?.keyHash ?? "-"}</code>
              <span>Request confirmations</span>
              <span>{vrfData?.requestConfirmations ?? "-"}</span>
              <span>Callback gas limit</span>
              <span>{vrfData?.callbackGasLimit ?? "-"}</span>
              <span>Native payment</span>
              <span>{vrfData ? (vrfData.nativePayment ? "true" : "false") : "-"}</span>
            </div>
          </article>
        </section>
      </main>
    </ClientOnly>
  );
}

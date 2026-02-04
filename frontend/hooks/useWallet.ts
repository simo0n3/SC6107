"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserProvider, JsonRpcSigner } from "ethers";
import { SEPOLIA_CHAIN_ID } from "@/lib/config";

type InjectedProvider = {
  isMetaMask?: boolean;
  providers?: InjectedProvider[];
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

type WalletState = {
  provider: BrowserProvider | null;
  signer: JsonRpcSigner | null;
  address: string;
  chainId: number | null;
  hasProvider: boolean;
  isSepolia: boolean;
  connect: () => Promise<void>;
  refresh: () => Promise<void>;
};

function getInjectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined" || !window.ethereum) {
    return null;
  }

  const injected = window.ethereum as InjectedProvider;
  if (Array.isArray(injected.providers) && injected.providers.length > 0) {
    const metaMask = injected.providers.find((entry) => entry?.isMetaMask);
    return metaMask ?? injected.providers[0];
  }

  return injected;
}

export function useWallet(): WalletState {
  const [provider] = useState<BrowserProvider | null>(() => {
    const injected = getInjectedProvider();
    if (!injected) {
      return null;
    }
    return new BrowserProvider(injected as never);
  });
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null);
  const [address, setAddress] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!provider) return;
    const accounts = (await provider.send("eth_accounts", [])) as string[];
    const network = await provider.getNetwork();
    setChainId(Number(network.chainId));

    if (accounts.length === 0) {
      setSigner(null);
      setAddress("");
      return;
    }

    const nextSigner = await provider.getSigner();
    setSigner(nextSigner);
    setAddress(await nextSigner.getAddress());
  }, [provider]);

  const connect = useCallback(async () => {
    if (!provider) return;
    await provider.send("eth_requestAccounts", []);
    await refresh();
  }, [provider, refresh]);

  useEffect(() => {
    if (!provider) return;
    const timer = setTimeout(() => {
      void refresh();
    }, 0);

    const injected = getInjectedProvider();
    if (!injected?.on) return;

    const onAccountsChanged = () => void refresh();
    const onChainChanged = () => void refresh();

    injected.on("accountsChanged", onAccountsChanged);
    injected.on("chainChanged", onChainChanged);

    return () => {
      clearTimeout(timer);
      injected.removeListener?.("accountsChanged", onAccountsChanged);
      injected.removeListener?.("chainChanged", onChainChanged);
    };
  }, [provider, refresh]);

  return useMemo(
    () => ({
      provider,
      signer,
      address,
      chainId,
      hasProvider: Boolean(provider),
      isSepolia: chainId === SEPOLIA_CHAIN_ID,
      connect,
      refresh,
    }),
    [provider, signer, address, chainId, connect, refresh],
  );
}

import { JsonRpcProvider, getAddress, isAddress } from "ethers";

type CacheEntry = {
  name: string | null;
  expiresAt: number;
};

const ENS_CACHE_PREFIX = "ens-cache:v1:";
const ENS_CACHE_TTL_MS = 60 * 60 * 1000;
const memoryCache = new Map<string, CacheEntry>();
let provider: JsonRpcProvider | null | undefined;

function getMainnetProvider(): JsonRpcProvider | null {
  if (provider !== undefined) return provider;
  const rpcUrl = process.env.NEXT_PUBLIC_MAINNET_RPC_URL ?? "";
  if (!rpcUrl) {
    provider = null;
    return provider;
  }
  provider = new JsonRpcProvider(rpcUrl, "mainnet");
  return provider;
}

function getCacheKey(address: string): string {
  return `${ENS_CACHE_PREFIX}${address.toLowerCase()}`;
}

function readLocalCache(address: string): CacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(getCacheKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(address: string, entry: CacheEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getCacheKey(address), JSON.stringify(entry));
  } catch {
    // ignore storage quota / privacy mode errors
  }
}

function writeCache(address: string, name: string | null): string | null {
  const entry: CacheEntry = {
    name,
    expiresAt: Date.now() + ENS_CACHE_TTL_MS,
  };
  memoryCache.set(address.toLowerCase(), entry);
  writeLocalCache(address, entry);
  return name;
}

function readCache(address: string): string | null | undefined {
  const lower = address.toLowerCase();
  const now = Date.now();
  const cached = memoryCache.get(lower);
  if (cached && cached.expiresAt > now) {
    return cached.name;
  }

  const localEntry = readLocalCache(lower);
  if (!localEntry) return undefined;
  if (localEntry.expiresAt <= now) return undefined;

  memoryCache.set(lower, localEntry);
  return localEntry.name;
}

export async function resolveEns(address: string): Promise<string | null> {
  if (!isAddress(address)) return null;

  const checksummed = getAddress(address);
  const cached = readCache(checksummed);
  if (cached !== undefined) return cached;

  const mainnet = getMainnetProvider();
  if (!mainnet) return writeCache(checksummed, null);

  try {
    const name = await mainnet.lookupAddress(checksummed);
    if (!name) return writeCache(checksummed, null);

    const resolvedAddress = await mainnet.resolveName(name);
    if (!resolvedAddress) return writeCache(checksummed, null);
    if (resolvedAddress.toLowerCase() !== checksummed.toLowerCase()) return writeCache(checksummed, null);

    return writeCache(checksummed, name);
  } catch {
    return writeCache(checksummed, null);
  }
}

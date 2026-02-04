import { formatUnits, ZeroAddress } from "ethers";
import { SEPOLIA_EXPLORER } from "./config";

export function shortAddress(address: string): string {
  if (!address) return "-";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function isEthToken(token: string): boolean {
  return token.toLowerCase() === ZeroAddress.toLowerCase();
}

export function formatAmount(value: bigint, decimals = 18, precision = 6): string {
  const raw = formatUnits(value, decimals);
  const [head, tail = ""] = raw.split(".");
  if (precision === 0) return head;
  return tail.length > 0 ? `${head}.${tail.slice(0, precision)}` : head;
}

export function explorerTx(txHash: string): string {
  return `${SEPOLIA_EXPLORER}/tx/${txHash}`;
}

export function explorerAddress(address: string): string {
  return `${SEPOLIA_EXPLORER}/address/${address}`;
}

export function toDateTime(ts: number | bigint): string {
  if (!ts) return "-";
  const value = typeof ts === "bigint" ? Number(ts) : ts;
  return new Date(value * 1000).toLocaleString();
}


import type { Eip1193Provider } from "ethers";

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: "accountsChanged" | "chainChanged", listener: () => void) => void;
      removeListener?: (event: "accountsChanged" | "chainChanged", listener: () => void) => void;
    };
  }
}

export {};


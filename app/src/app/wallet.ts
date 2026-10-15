// Wallet discovery (EIP-6963) and message signing. Sign-in only ever asks the
// wallet for accounts and a personal_sign — never a transaction or approval.

type Eip1193 = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };
export type Wallet = { id: string; name: string; icon: string | null; provider: Eip1193 };

declare global {
  interface Window {
    ethereum?: Eip1193;
  }
}

export function discoverWallets(waitMs = 450): Promise<Wallet[]> {
  return new Promise((resolve) => {
    const found = new Map<string, Wallet>();
    const onAnnounce = (event: Event) => {
      const { info, provider } = (event as CustomEvent).detail ?? {};
      if (!info?.uuid || !provider) return;
      found.set(info.uuid, { id: info.rdns ?? info.uuid, name: info.name, icon: info.icon ?? null, provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      if (found.size === 0 && window.ethereum) {
        found.set("injected", { id: "injected", name: "Browser wallet", icon: null, provider: window.ethereum });
      }
      resolve([...found.values()]);
    }, waitMs);
  });
}

function utf8ToHex(text: string): string {
  return "0x" + [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class WalletError extends Error {
  constructor(public code: "user_rejected" | "no_account" | "wallet_error") {
    super(code);
  }
}

function asWalletError(err: unknown): WalletError {
  const code = (err as { code?: number })?.code;
  return new WalletError(code === 4001 ? "user_rejected" : "wallet_error");
}

export async function requestAccount(wallet: Wallet): Promise<string> {
  const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" }).catch((e) => {
    throw asWalletError(e);
  })) as string[];
  if (!accounts?.[0]) throw new WalletError("no_account");
  return accounts[0];
}

export async function signMessage(wallet: Wallet, address: string, message: string): Promise<string> {
  return (await wallet.provider.request({ method: "personal_sign", params: [utf8ToHex(message), address] }).catch((e) => {
    throw asWalletError(e);
  })) as string;
}

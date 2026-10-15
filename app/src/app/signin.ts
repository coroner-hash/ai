// Wallet sign-in flow against worker/auth.ts:
// discover wallet → account → server writes SIWE message → personal_sign → server verifies → session cookie.
import { get, post, type Result } from "./api";
import { discoverWallets, requestAccount, signMessage, WalletError, type Wallet } from "./wallet";

export async function currentAddress(): Promise<string | null> {
  const r = await get<{ address: string | null }>("/api/auth/me");
  return r.ok ? r.data.address : null;
}

export async function listWallets(): Promise<Wallet[]> {
  return discoverWallets();
}

export async function signIn(wallet: Wallet): Promise<Result<{ address: string }>> {
  try {
    const address = await requestAccount(wallet);
    const nonce = await post<{ message: string }>("/api/auth/nonce", { address });
    if (!nonce.ok) return nonce;
    const signature = await signMessage(wallet, address, nonce.data.message);
    return post<{ address: string }>("/api/auth/verify", { message: nonce.data.message, signature });
  } catch (err) {
    const code = err instanceof WalletError ? err.code : "wallet_error";
    return { ok: false, status: 0, error: code };
  }
}

export async function signOut(): Promise<void> {
  await post("/api/auth/logout");
}

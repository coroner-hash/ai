// Everything that reads the chain. Kept free of Worker-only imports so Node
// test scripts can import it too.
// To target another EVM chain, swap the import (e.g. `base`, `arbitrum`) or
// define one with viem's defineChain.
import { createPublicClient, erc20Abi, http, type Address, type PublicClient } from "viem";
import { robinhood as CHAIN } from "viem/chains";

export const CHAIN_ID = CHAIN.id;
export const EXPLORER = CHAIN.blockExplorers?.default.url ?? "";

/**
 * Public RPCs rate-limit Cloudflare's shared egress IPs, so requests are
 * batched (JSON-RPC batch + Multicall3 for contract reads) and retried with
 * backoff. Set the RPC_URL secret to a dedicated provider to avoid the limit.
 */
export function chainClient(rpcUrl?: string): PublicClient {
  return createPublicClient({
    chain: CHAIN,
    batch: { multicall: { wait: 10 } },
    transport: http(rpcUrl || CHAIN.rpcUrls.default.http[0], {
      batch: { wait: 10, batchSize: 25 },
      timeout: 12_000,
      retryCount: 3,
      retryDelay: 600,
    }),
  }) as PublicClient;
}

/** Thrown when the RPC itself fails, so callers never cache a transport error as "no data". */
export class ChainUnavailable extends Error {}

export type TokenInfo = {
  address: Address;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: bigint | null;
};

/** ERC-20 metadata. Returns null when there is no contract at the address. */
export async function readToken(client: PublicClient, address: Address): Promise<TokenInfo | null> {
  const code = await client.getCode({ address }).catch((err) => {
    throw new ChainUnavailable(String(err?.shortMessage ?? err));
  });
  if (!code || code === "0x") return null;

  const results = await client
    .multicall({
      contracts: (["name", "symbol", "decimals", "totalSupply"] as const).map((functionName) => ({ address, abi: erc20Abi, functionName })),
      allowFailure: true,
    })
    .catch((err) => {
      throw new ChainUnavailable(String(err?.shortMessage ?? err));
    });
  // Per-call failures here are genuine: the contract doesn't implement that getter.
  const value = <T>(i: number) => (results[i].status === "success" ? (results[i].result as T) : null);
  const decimals = value<number>(2);
  return {
    address,
    name: value<string>(0),
    symbol: value<string>(1),
    decimals: decimals === null ? null : Number(decimals),
    totalSupply: value<bigint>(3),
  };
}

export async function balanceOf(client: PublicClient, token: Address, holder: Address): Promise<bigint | null> {
  return client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [holder] }).catch(() => null);
}

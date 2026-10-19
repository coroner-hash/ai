// OpenAPI description of the public API v1. Served at /api/v1/openapi.json.
const address = { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Token contract address on Robinhood Chain (chain id 4663)." };
const verdictResponse = {
  description: "A verdict with the evidence attached, plus a plain-language narrative.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          api_version: { type: "string", example: "v1" },
          engine: { type: "string", enum: ["rules"], description: "What produced the answer. Today: the open rule engine. The model is not serving this API yet." },
          model: { type: "null" },
          rule_baseline: { type: "boolean" },
          verdict: { type: "object", description: "risk_class, flags (each with evidence_ids), evidence, confidence, disclaimer." },
          facts: { type: "object" },
          narrative: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
};
const err = { description: "Error: invalid_address, invalid_body, rate_limited (429, see Retry-After), chain_unavailable (503)." };

export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "Coroner API",
    version: "1.0.0",
    description:
      "Risk classification from public on-chain data on Robinhood Chain. Not financial advice. Labels describe patterns consistent with the numbers, never accusations. Answers come from the open rule engine today; each response states its engine.",
  },
  servers: [{ url: "https://coronerai.pro" }],
  paths: {
    "/api/v1/verdict/{address}": {
      get: {
        summary: "Verdict from contract facts only",
        description: "The server reads the contract (owner, mint, blacklist, pause, proxy). Market and holder data are not available server-side: use POST to supply them.",
        parameters: [{ name: "address", in: "path", required: true, schema: address }],
        responses: { "200": verdictResponse, "400": err, "404": { description: "not_a_contract" }, "429": err, "503": err },
      },
    },
    "/api/v1/verdict": {
      post: {
        summary: "Verdict with market and holder facts you supply",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address"],
                properties: {
                  address,
                  mode: { type: "string", enum: ["live", "draft"] },
                  ext: {
                    type: "object",
                    properties: {
                      market: { type: "object", properties: { poolCount: { type: "number" }, liqUsd: { type: "number" }, vol24Usd: { type: "number" }, fdvUsd: { type: ["number", "null"] }, buys24: { type: "number" }, sells24: { type: "number" }, poolCreated: { type: "string" } } },
                      holders: { type: "object", properties: { count: { type: "number" }, top1Pct: { type: "number" }, top10Pct: { type: "number" }, top1IsContract: { type: "boolean" }, top1Address: { type: "string" } } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "200": verdictResponse, "400": err, "429": err, "503": err },
      },
    },
    "/api/v1/premortem": {
      post: {
        summary: "Pre-mortem of a launch draft",
        description: "Send what you know about the draft. Fields are optional but at least one of name, symbol, description, source, teamAllocationPct or liquidityLock is required.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" }, symbol: { type: "string" }, description: { type: "string" },
                  buyTaxPct: { type: "number" }, sellTaxPct: { type: "number" }, teamAllocationPct: { type: "number" },
                  allocationSplit: { type: "string", enum: ["one_wallet", "several_wallets", "vesting"] },
                  liquidityUsd: { type: "number" }, liquidityLock: { type: "string", enum: ["none", "short", "long"] },
                  taxChangeable: { type: "boolean" }, hasMint: { type: "boolean" }, ownerRenounce: { type: "boolean" }, hasBlacklist: { type: "boolean" }, hasPause: { type: "boolean" },
                  source: { type: "string", description: "Solidity source, up to about 24 KB." },
                },
              },
            },
          },
        },
        responses: { "200": verdictResponse, "400": err, "429": err },
      },
    },
    "/api/v1/autopsy": {
      post: {
        summary: "Autopsy of a token the open collector watched for 24 hours",
        description: "Pass the tracked record from the public collector data (github.com/coroner-hash/ai, data/shards).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["address", "record"],
                properties: {
                  address,
                  record: {
                    type: "object",
                    required: ["created", "first", "outcome"],
                    properties: {
                      symbol: { type: "string" }, created: { type: "string", format: "date-time" },
                      first: { type: "object", properties: { liq_usd: { type: "number" }, fdv_usd: { type: "number" }, vol_h24: { type: "number" }, buys_h24: { type: "number" }, sells_h24: { type: "number" } } },
                      outcome: { type: "object", properties: { liq_usd: { type: "number" }, fdv_usd: { type: "number" }, vol_h24: { type: "number" }, buys_h24: { type: "number" }, sells_h24: { type: "number" } } },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "200": verdictResponse, "400": err, "429": err, "503": err },
      },
    },
  },
};

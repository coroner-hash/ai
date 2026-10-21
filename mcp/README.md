# Coroner MCP server

Gives an AI agent three tools for tokens on Robinhood Chain (chain id 4663):

| Tool | What it does |
|---|---|
| `check_token` | Risk verdict for a deployed token: contract, market and holders, every flag tied to its evidence. |
| `premortem` | Before you launch: describe a draft, get the risks the market will see and what to change. |
| `autopsy_token` | What happened to a token the open collector watched for 24 hours (tokens recorded since 14 Oct 2026). |

**Status: live, rule-based.** Answers come from the open rule engine; each reply says `engine: "rules"` and `model: null`. When the Coroner model is hosted this will change, and the reply will say so. Risk classification from public on-chain data, not financial advice. Labels describe patterns consistent with the numbers, never accusations.

## How it works
Blockscout and GeckoTerminal block cloud servers, so the market and holder data are read **on your machine**, then sent with the address to the Coroner API (`https://coronerai.pro/api/v1`), which reads the contract and applies the rules. No key, no account. The API is rate-limited per IP.

## Install
Needs Node 20 or newer.

```bash
git clone https://github.com/coroner-hash/ai.git
cd ai/mcp && npm install
```

Claude Desktop, Claude Code, Cursor and other MCP clients take a server entry like this (use the absolute path to `server.mjs`):

```json
{
  "mcpServers": {
    "coroner": {
      "command": "node",
      "args": ["/absolute/path/to/ai/mcp/server.mjs"]
    }
  }
}
```

Claude Code: `claude mcp add coroner -- node /absolute/path/to/ai/mcp/server.mjs`

Optional: `CORONER_API` overrides the API origin (default `https://coronerai.pro`).

## Test
```bash
node smoke.mjs            # lists the tools and calls each once
node smoke.mjs 0xYourToken
```

Licence: Apache-2.0.

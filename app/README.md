# Coroner app

The website and API behind Coroner: a Cloudflare Worker (Hono, D1) plus static pages built with Vite.

| Path | What |
|---|---|
| `worker/rules.ts` | Verdict rules (rule baseline): flags, risk class, evidence ids |
| `worker/premortem.ts` | Pre-mortem rules for launch drafts and contract source |
| `worker/autopsy.ts` | Autopsy labels for pools watched for 24 hours |
| `worker/verdict.ts`, `rpc.ts` | Contract facts over JSON-RPC with provider fallback |
| `worker/*Route.ts` | API routes: `/api/verdict`, `/api/premortem`, `/api/autopsy` |
| `index.html`, `check.html`, `premortem.html`, `autopsy.html` | Pages (`src/` has their scripts and styles) |
| `scripts/gen-sft.mjs` | Builds the training dataset by running the same rules (see `../training`) |

The rule files have no imports on purpose: the Worker and the dataset generator run the exact same code.

## Run it
```bash
npm install
cp wrangler.example.jsonc wrangler.jsonc     # then set your D1 id and domain
cp .dev.vars.example .dev.vars               # local secrets, never commit
npm run db:migrate:local
npm run dev
```
Production secrets are set with `npx wrangler secret put <NAME>` (`TURNSTILE_SECRET`, `IP_SALT`, `RPC_URL`, optionally `RPC_URL_2`, `RESEND_API_KEY`).

## Honest limits
- Reports come from transparent rules today. The Coroner model is in development.
- Market and holder facts are read in the visitor's browser (Blockscout, GeckoTerminal block server access), then sent to the Worker.
- Risk classification from public on-chain data. Not financial advice.

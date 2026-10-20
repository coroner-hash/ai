# Coroner

Open tooling for judging Robinhood Chain tokens: a deterministic facts builder, rule-based labels, and open models that read the facts and write a cited verdict.

**Token:** `$CORONER`, contract `0x48af9fe69e45b1ba7a1bbb42d9944d09cffb2f31` (Pons, launched via the Surplus launchpad, no dev buy). Other tokens also use the ticker CORONER or the name CoronerAI; only this contract is ours. Site: https://coronerai.pro

**Models (Apache-2.0):** [coroner-31b](https://huggingface.co/coronerai/coroner-31b) · [coroner-31b-GGUF](https://huggingface.co/coronerai/coroner-31b-GGUF) · [coroner-coder-7b](https://huggingface.co/coronerai/coroner-coder-7b)

> Risk classification from public on-chain data. Not financial advice. Labels describe patterns consistent with the observed numbers; they are not accusations.

## What is here

| Path | What |
|---|---|
| `coroner_facts.py` | Builds a fact sheet for a token address (JSON-RPC + GeckoTerminal): contract selectors, proxy resolution, owner, supply, pools, holders rebuilt from Transfer logs |
| `labels.py` | Weak rule labels for dead tokens: `lp_removed`, `bled_out`, `never_lived`, `clone` |
| `feeder/collect.py` | `collect` records the first sighting of new pools, `resolve` stores the outcome 24h later |
| `schema/verdict.schema.json` | Output format of the model |
| `training/` | LoRA training, evaluation and merge scripts for coroner-31b |
| `coder/` | Coroner Coder: compile-verified dataset generator, verifier, scorer |
| `mcp/` | MCP server: `check_token`, `premortem`, `autopsy_token` |
| `app/` | The website and API (Cloudflare Worker) |
| `.github/workflows/collect.yml` | Hourly data collection (state in `data/state.json`) |

## Run

```bash
python coroner_facts.py <token_address>      # RPC_URL env overrides the default RPC
python labels.py                             # self-test
python feeder/collect.py collect 10
python feeder/collect.py resolve
```

Python 3.10+, standard library only.

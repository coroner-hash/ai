# Coroner

Open tooling for judging Robinhood Chain tokens: a deterministic facts builder, rule-based labels and (soon) an open model that reads the facts and writes a cited verdict.

> Risk classification from public on-chain data. Not financial advice. Labels describe patterns consistent with the observed numbers; they are not accusations.

## What is here

| Path | What |
|---|---|
| `coroner_facts.py` | Builds a fact sheet for a token address (JSON-RPC + GeckoTerminal): contract selectors, proxy resolution, owner, supply, pools, holders rebuilt from Transfer logs |
| `labels.py` | Weak rule labels for dead tokens: `lp_removed`, `bled_out`, `never_lived`, `clone` |
| `feeder/collect.py` | `collect` records the first sighting of new pools, `resolve` stores the outcome 24h later |
| `schema/verdict.schema.json` | Output format of the model |
| `.github/workflows/collect.yml` | Hourly data collection (state in `data/state.json`) |

## Run

```bash
python coroner_facts.py <token_address>      # RPC_URL env overrides the default RPC
python labels.py                             # self-test
python feeder/collect.py collect 10
python feeder/collect.py resolve
```

Python 3.10+, standard library only.

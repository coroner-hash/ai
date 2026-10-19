---
license: apache-2.0
base_model: Qwen/Qwen2.5-Coder-7B-Instruct
library_name: transformers
pipeline_tag: text-generation
tags:
  - solidity
  - smart-contracts
  - token-risk
  - lora
language:
  - en
---

![Coroner: every token dies. We write the report.](https://raw.githubusercontent.com/coroner-hash/ai/main/release/banner.png)

# Coroner Coder 7B

A small model that fixes the patterns the Coroner scanner flags in an ERC-20 token contract: it takes a Solidity source plus the scanner's flags and returns a corrected contract and a short list of changes.

> Always compile and review the result yourself. A patch that compiles is not an audit. Not financial or security advice.

## What it fixes
The same patterns the Coroner pre-mortem scanner reports from source code:
`mint_with_live_owner`, `blacklist_function`, `pause_function`, `tax_changeable`, `risky_opcode` (selfdestruct, delegatecall, tx.origin) and `owner_privileges`.

## Training
- Base: Qwen2.5-Coder-7B-Instruct (Apache 2.0). Method: LoRA (rank 16) on 4-bit weights, one epoch (88 steps), then merged to 16-bit.
- Data: 1,400 synthetic examples. Each is a flawed token contract with its fix, generated from templates in two source layouts. **Every target is verified**: the corrected contract compiles with solc 0.8.24, keeps the ERC-20 interface and clears the flagged patterns. Generator and verifier: https://github.com/coroner-hash/ai/tree/main/coder

## Evaluation
A fix counts only if the patched contract compiles, keeps the ERC-20 interface, clears every flag and adds none. 40 held-out contracts in a third source layout the model never saw in training (greedy decoding):

| | Base model | Coroner Coder |
|---|---|---|
| Compiles | 1.00 | 0.925 |
| Flags cleared | 0.125 | 0.925 |
| Full fix (all checks) | 0.125 | 0.925 |

Returning the contract unchanged scores 0.05. In the layouts it was trained on the model scores 1.00, which mostly shows it learned the templates.

## Limits
- **Synthetic, narrow data.** All contracts are single-file ERC-20 variants without imports. Real contracts from a market will be messier; expect lower numbers. This is a first version.
- About 1 in 13 outputs did not compile in the held-out test. Always compile.
- It removes risky features; it does not find new bugs, and it can change behaviour. Review the diff.
- Only the scanner's six patterns. Not a general Solidity auditor.

Source, data generator and scorer: https://github.com/coroner-hash/ai

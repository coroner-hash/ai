#!/usr/bin/env bash
# Build a 4-bit GGUF (Q4_K_M) of coronerai/coroner-31b for llama.cpp and Ollama. Runs on the rented pod (needs about 120 GB of disk).
#   bash release/make_gguf.sh          # download, convert, quantize, quick test
# Upload afterwards (type the token in the terminal yourself):
#   export HF_TOKEN=   (then paste)   ;   hf upload coronerai/coroner-31b-GGUF /workspace/gguf/coroner-31b-Q4_K_M.gguf coroner-31b-Q4_K_M.gguf
set -e
export HF_HOME=/workspace/hf_cache
W=/workspace
mkdir -p $W/gguf
cd $W
[ -d llama.cpp ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp
cd llama.cpp
pip install -q -r requirements/requirements-convert_hf_to_gguf.txt
[ -x build/bin/llama-quantize ] || { cmake -B build -DGGML_CUDA=OFF -DLLAMA_CURL=OFF >/dev/null; cmake --build build --target llama-quantize llama-cli -j"$(nproc)"; }
hf download coronerai/coroner-31b --local-dir $W/m31
python convert_hf_to_gguf.py $W/m31 --outfile $W/gguf/coroner-31b-q8_0.gguf --outtype q8_0
./build/bin/llama-quantize --allow-requantize $W/gguf/coroner-31b-q8_0.gguf $W/gguf/coroner-31b-Q4_K_M.gguf Q4_K_M
rm -f $W/gguf/coroner-31b-q8_0.gguf
ls -lh $W/gguf
# quick test: the system prompt and a tiny fact sheet; expect one JSON object
./build/bin/llama-cli -m $W/gguf/coroner-31b-Q4_K_M.gguf -n 160 --temp 0 -no-cnv -p "Reply with one JSON object with keys mode, risk_class. Fact sheet: {\"mode\":\"live\",\"contract.selector_mint\":true,\"contract.owner_renounced\":false}" 2>/dev/null | tail -5

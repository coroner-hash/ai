#!/usr/bin/env bash
# Pre-check a Hugging Face repo against the Surplus launchpad rules (no signing, no secrets).
# Usage: bash release/precheck_surplus.sh coronerai/coroner-31b
set -e
REPO="${1:?usage: precheck_surplus.sh ORG/REPO}"
CFG=$(curl -s https://api.surplusllm.com/api/launchpad/config)
MIN=$(echo "$CFG" | python -c "import sys,json;print(json.load(sys.stdin)['data']['minModelParams'])")
MAX=$(echo "$CFG" | python -c "import sys,json;print(json.load(sys.stdin)['data']['maxModelParams'])")
echo "Surplus size limits (live): $MIN .. $MAX parameters"
curl -s "https://huggingface.co/api/models/$REPO/revision/main" | python -c "
import sys,json
d=json.load(sys.stdin)
if 'error' in d: print('HF error:',d['error']); sys.exit(1)
sib=[s['rfilename'] for s in d.get('siblings',[])]
arch=(d.get('config') or {}).get('architectures',[None])[0]
chat=((d.get('config') or {}).get('tokenizer_config') or {}).get('chat_template') is not None or any(f in sib for f in ('chat_template.jinja','chat_template.json'))
params=(d.get('safetensors') or {}).get('total')
lic=(d.get('cardData') or {}).get('license')
ALLOWED=['LlamaForCausalLM','MistralForCausalLM','MixtralForCausalLM','Qwen2ForCausalLM','Qwen3ForCausalLM','Qwen3MoeForCausalLM','Gemma2ForCausalLM','Gemma3ForCausalLM','Gemma4ForCausalLM','Gemma4ForConditionalGeneration','Phi3ForCausalLM','GraniteForCausalLM','OlmoForCausalLM','Olmo2ForCausalLM']
LIC=['apache-2.0','mit','bsd-3-clause','llama3','llama3.1','llama3.2','llama3.3','gemma']
checks={
 'public (not private)': not d.get('private'),
 'not gated': not d.get('gated'),
 'safetensors weights': any(f.endswith('.safetensors') for f in sib),
 'params in range (%s)'%params: params is not None and 20e9<=params<=34e9,
 'architecture allowed (%s)'%arch: arch in ALLOWED,
 'chat template present': chat,
 'license ok (%s)'%lic: lic in LIC,
 'README.md present': 'README.md' in sib,
}
for k,v in checks.items(): print(('PASS ' if v else 'FAIL ')+k)
print('commit:',d['sha'][:7])
print('NOTE: the surplus-launcher: <wallet> line inside README.md must be added by the owner and is checked by Surplus at prepare time.')
"

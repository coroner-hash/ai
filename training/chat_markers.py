"""Derive training text and response-only markers from a model's own chat template, so the same script works for
Qwen (<|im_start|>), Gemma 4 (<|turn>) and others.

Why: the text we train on must be exactly what the model sees at inference.
  prompt (system+user, add_generation_prompt=True)  +  assistant JSON  +  end-of-turn suffix
Gemma 4's generation prompt ends with an empty thinking channel; Qwen3.5's with an empty <think> block. Using the
generation prompt for training keeps both identical.
"""

SENTINEL = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "UUU"}, {"role": "assistant", "content": "AAA"}]


def _render(tok, msgs, **kw):
    try:
        return tok.apply_chat_template(msgs, tokenize=False, enable_thinking=False, **kw)
    except TypeError:
        return tok.apply_chat_template(msgs, tokenize=False, **kw)


def detect(tok):
    """Return dict(suffix, instruction_part, response_part) for this tokenizer's chat template."""
    full = _render(tok, SENTINEL, add_generation_prompt=False)
    if full.count("AAA") != 1 or full.count("UUU") != 1:
        raise ValueError("unexpected chat template output: " + repr(full[:200]))
    suffix = full.split("AAA", 1)[1]  # end-of-turn marker(s) after the assistant text, e.g. "<turn|>\n"
    head, rest = full.split("UUU", 1)
    # the user turn starts at the last turn-start token before UUU: e.g. "<|turn>user\n"
    turn_start = None
    for cand in ("<|im_start|>", "<|turn>", "<start_of_turn>", "<|start_header_id|>"):
        if cand in head:
            turn_start = cand
            break
    if turn_start is None:
        raise ValueError("could not find a turn-start token in: " + repr(head))
    instruction_part = head[head.rindex(turn_start):]
    between = rest.split("AAA", 1)[0]  # end of the user turn + assistant header (+ any stub)
    i = between.index(turn_start)
    j = between.index("\n", i) + 1 if "\n" in between[i:] else len(between)
    response_part = between[i:j]
    return {"suffix": suffix, "instruction_part": instruction_part, "response_part": response_part}


def training_text(tok, messages, markers=None):
    """system+user as the model will see them at inference, then the assistant answer, then the end-of-turn suffix."""
    m = markers or detect(tok)
    prompt = _render(tok, messages[:2], add_generation_prompt=True)
    return prompt + messages[2]["content"] + m["suffix"]


if __name__ == "__main__":  # offline check: python training/chat_markers.py <repo> [<repo> ...]
    import sys
    from transformers import AutoTokenizer

    for repo in sys.argv[1:] or ["unsloth/Qwen3.5-0.8B", "google/gemma-4-31B-it"]:
        tok = AutoTokenizer.from_pretrained(repo)
        m = detect(tok)
        print("=====", repo)
        print(m)
        sample = [{"role": "system", "content": "S"}, {"role": "user", "content": "U"}, {"role": "assistant", "content": '{"a":1}'}]
        print(repr(training_text(tok, sample, m)))

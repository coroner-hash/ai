"""Stage 1+2 of the dataset pipeline.

collect  : pull recent pools from GeckoTerminal, remember the FIRST sighting of each pool.
resolve  : for pools first seen >= 24h ago, fetch the pool again and store the outcome.

State lives in data/state.json  {pool_address: {"first": {...}, "outcome": {...}|null}}.
Run `python feeder/collect.py collect [pages]` hourly and `python feeder/collect.py resolve` daily
(GitHub Actions; public API, ~2s between calls).
"""
import json, sys, time, datetime, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from snapshot_pools import get, slim, BASE  # noqa: E402
from shards import write_shards  # noqa: E402

DATA = pathlib.Path(__file__).resolve().parent.parent / "data"
STATE = DATA / "state.json"
NOW = lambda: datetime.datetime.now(datetime.timezone.utc)


def load():
    return json.loads(STATE.read_text(encoding="utf8")) if STATE.exists() else {}


def save(st):
    DATA.mkdir(exist_ok=True)
    STATE.write_text(json.dumps(st, indent=1), encoding="utf8")


def metrics(row):
    tx = row.get("tx_h24") or {}
    f = lambda k: float(row[k]) if row.get(k) not in (None, "") else None
    return {
        "at": NOW().isoformat(timespec="seconds"),
        "liq_usd": f("liq_usd"), "fdv_usd": f("fdv_usd"), "vol_h24": f("vol_h24"),
        "buys_h24": tx.get("buys"), "sells_h24": tx.get("sells"),
    }


def collect(pages=5):
    st, added = load(), 0
    for page in range(1, pages + 1):
        d = get(f"{BASE}/new_pools?page={page}")
        if not d or "data" not in d:
            break
        for p in d["data"]:
            row = slim(p)
            if row["pool"] in st:
                continue
            st[row["pool"]] = {
                "token": row["base_token"], "name": row["name"], "symbol": row["name"].split(" / ")[0],
                "dex": row["dex"], "created": row["created"], "first": metrics(row), "outcome": None,
            }
            added += 1
        time.sleep(2.2)
    save(st)
    print(f"collect: +{added} pools, total {len(st)}")


def resolve(min_age_h=24):
    st, done = load(), 0
    for addr, rec in st.items():
        if rec["outcome"]:
            continue
        created = datetime.datetime.fromisoformat(rec["created"].replace("Z", "+00:00"))
        if (NOW() - created).total_seconds() < min_age_h * 3600:
            continue
        d = get(f"{BASE}/pools/{addr}")
        time.sleep(2.2)
        if not d or "data" not in d:
            continue
        rec["outcome"] = metrics(slim(d["data"]))
        done += 1
    save(st)
    print(f"resolve: {done} outcomes stored; shards changed: {write_shards(st)}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "collect"
    if cmd == "collect":
        collect(int(sys.argv[2]) if len(sys.argv) > 2 else 5)
    else:
        resolve()

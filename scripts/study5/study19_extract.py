# Study 19 step 1: rebuild the OKX BTC-USDT-SWAP L2 book (400 levels) for one day and save one row per minute. Usage: SD=... python3 study19_extract.py YYYY-MM-DD
import sys, os, subprocess, json, numpy as np, pandas as pd
try: import orjson; loads = orjson.loads
except Exception: loads = json.loads
SD = os.environ["SD"]; day = sys.argv[1]; ymd = day.replace("-", "")
url = f"https://static.okx.com/cdn/okx/match/orderbook/L2/400lv/daily/{ymd}/BTC-USDT-SWAP-L2orderbook-400lv-{day}.tar.gz"; fp = f"/tmp/okx/{day}.tar.gz"
if not os.path.exists(fp): subprocess.run(["curl", "-s", "-f", "-o", fp, url], check=True)
bids, asks, rows, cur = {}, {}, [], None
def stat():
    if not bids or not asks: return None
    bp = np.array(list(bids.keys())); bs = np.array(list(bids.values())); ap = np.array(list(asks.keys())); as_ = np.array(list(asks.values()))
    bb, ba = bp.max(), ap.min(); mid = (bb + ba) / 2; out = {"bb": bb, "ba": ba, "mid": mid}
    for b in (5, 10, 25):
        out[f"b{b}"] = bs[bp >= mid * (1 - b / 1e4)].sum(); out[f"a{b}"] = as_[ap <= mid * (1 + b / 1e4)].sum()
    return out
p = subprocess.Popen(["tar", "xzf", fp, "-O"], stdout=subprocess.PIPE, bufsize=1 << 20)
for line in p.stdout:
    d = loads(line); ts = int(d["ts"]); m = ts // 60000
    if cur is None: cur = m
    if m != cur:  # state at the end of the previous minute
        s = stat()
        if s: s["min"] = cur; rows.append(s)
        cur = m
    if d["action"] == "snapshot": bids.clear(); asks.clear()
    for side, book in (("bids", bids), ("asks", asks)):
        for lv in d[side]:
            px = float(lv[0]); sz = float(lv[1])
            if sz == 0: book.pop(px, None)
            else: book[px] = sz
s = stat()
if s: s["min"] = cur; rows.append(s)
os.makedirs(f"{SD}/okx", exist_ok=True); pd.DataFrame(rows).to_pickle(f"{SD}/okx/{day}.pkl"); os.remove(fp); print(day, len(rows))

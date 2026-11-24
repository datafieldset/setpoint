# Study 14 step 1: reduce one month of Binance spot aggTrades to small tables. Usage: SD=... python3 study14_extract.py YYYY-MM
import sys, os, io, zipfile, subprocess, numpy as np, pandas as pd
SD = os.environ["SD"]; ym = sys.argv[1]; zp = f"/tmp/agg/BTCUSDT-aggTrades-{ym}.zip"
url = f"https://data.binance.vision/data/spot/monthly/aggTrades/BTCUSDT/BTCUSDT-aggTrades-{ym}.zip"
if not os.path.exists(zp): subprocess.run(["curl", "-s", "-f", "-o", zp, url], check=True)
z = zipfile.ZipFile(zp); name = z.namelist()[0]
mins, buck, groups = [], [], []
for ch in pd.read_csv(z.open(name), header=None, usecols=[1, 2, 5, 6], names=["p", "q", "ts", "m"], chunksize=4_000_000, dtype={"p": "float64", "q": "float64", "ts": "int64", "m": "bool"}):
    ts = ch.ts.values; ts = np.where(ts > 1e14, ts // 1000, ts); ch["ts"] = ts; ch["min"] = ts // 60000; ch["b"] = ts // 300000; ch["side"] = np.where(ch.m.values, -1, 1)  # taker sell if buyer is maker
    mins.append(ch.groupby("min").p.agg(["first", "last"]).reset_index())
    buck.append(ch.groupby("b").q.sum().reset_index())
    gm = ch.groupby(["b", "q", "side", "min"]).size().reset_index(name="n")  # prints of one size and side in one minute
    g = gm.groupby(["b", "q", "side"]).agg(n=("n", "sum"), nmin=("n", "size")).reset_index(); g["qs"] = g.q * g.n
    groups.append(g[g.n >= 2])
M = pd.concat(mins).groupby("min").agg(first=("first", "first"), last=("last", "last")).reset_index()
B = pd.concat(buck).groupby("b").q.sum().reset_index()
G = pd.concat(groups).groupby(["b", "q", "side"]).agg(n=("n", "sum"), nmin=("nmin", "sum"), qs=("qs", "sum")).reset_index()  # chunks split a minute only at chunk edges, so nmin can over-count by at most a few
os.makedirs(f"{SD}/agg", exist_ok=True); pd.to_pickle((M, B, G), f"{SD}/agg/{ym}.pkl"); os.remove(zp); print(ym, len(M), len(B), len(G))

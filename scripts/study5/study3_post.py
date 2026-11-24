# POST-HOC look (not one of the pre-registered tries, so it cannot count as a pass): the premium CONT 24h z>=1.5 lead, by side and by year, gross and net.
import numpy as np, pandas as pd
from lib import *
b = load("k1h"); cb = pd.read_pickle(f"{SD}/cb1h.pkl").drop_duplicates("t").set_index("t")
cbc = np.array([cb.close.get(t, np.nan) for t in b.t]); prem = (cbc / b.c - 1) * 100; L = 168
ps = pd.Series(prem); z = ((ps - ps.rolling(L).mean().shift(1)) / ps.rolling(L).std().shift(1)).values
H = 24; rows = []; free = 0
for i in range(L + 1, b.n - H - 2):
    if i < free or not np.isfinite(z[i]) or abs(z[i]) < 1.5: continue
    d = 1 if z[i] > 0 else -1; g = d * (b.o[i + 1 + H] / b.o[i + 1] - 1) * 100; rows.append((b.t[i + 1], d, g)); free = i + 1 + H
df = pd.DataFrame(rows, columns=["t", "d", "gross"]); df["yr"] = pd.to_datetime(df.t, unit="ms").dt.year; df["net"] = df.gross - 0.20
print("by side:"); print(df.groupby("d").agg(n=("net", "size"), gross=("gross", "mean"), net=("net", "mean"), win=("net", lambda x: (x > 0).mean() * 100)).round(3))
print("by year, both sides:"); print(df.groupby("yr").agg(n=("net", "size"), gross=("gross", "mean"), net=("net", "mean")).round(3))
print("long side by year:"); print(df[df.d > 0].groupby("yr").agg(n=("net", "size"), net=("net", "mean")).round(3).T)
print("short side by year:"); print(df[df.d < 0].groupby("yr").agg(n=("net", "size"), net=("net", "mean")).round(3).T)

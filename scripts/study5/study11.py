# Study 11: regime split (above/below the 200-day) of the premium, positioning and stack leads. Rules in memory/overhaul-plan.md.
import numpy as np, pandas as pd
from lib import *
import study10_lib as X
s = X.s; zp, zl = X.zp, X.zl
day = s.t // 86400000; dc = pd.Series(s.c).groupby(day).last(); a200 = dc.rolling(200).mean().shift(1)
reg = np.array([np.sign(s.c[i] - a200.get(day[i], np.nan)) if np.isfinite(a200.get(day[i], np.nan)) else 0 for i in range(s.n)])
def trades(sig, H):
    free, out = 0, []
    for i in range(s.n - H - 2):
        if i < free or sig[i] == 0: continue
        g = sig[i] * (s.o[i + 1 + H] / s.o[i + 1] - 1) * 100; out.append((s.t[i + 1], g, reg[i], sig[i])); free = i + 1 + H
    return pd.DataFrame(out, columns=["t", "g", "reg", "d"])
prem = np.where(np.isfinite(zp) & (np.abs(zp) >= 1.5), np.sign(zp), 0); pos = np.where(np.isfinite(zl) & (np.abs(zl) >= 2), -np.sign(zl), 0)
up = np.isfinite(zp) & np.isfinite(zl) & (zp >= 1) & (zl <= -1); dn = np.isfinite(zp) & np.isfinite(zl) & (zp <= -1) & (zl >= 1); stack = np.where(up, 1, np.where(dn, -1, 0))
for name, sig, H in [("premium follow 24h", prem, 24), ("positioning fade 4h", pos, 4), ("stack 24h", stack, 24)]:
    df = trades(sig, H); df["per"] = np.where(pd.to_datetime(df.t, unit="ms").dt.year >= 2025, "2025-26", "2017-24"); df = df[df.reg != 0]; df["R"] = np.where(df.reg > 0, "above 200d", "below 200d")
    print(f"\n{name}  (gross %, net = gross - 0.20)")
    for per in ["2017-24", "2025-26"]:
        for R in ["above 200d", "below 200d"]:
            q = df[(df.per == per) & (df.R == R)]
            if len(q): print(f"  {per:8s} {R:11s} n={len(q):4d} gross={q.g.mean():+.2f} net={q.g.mean()-0.2:+.2f} win(net)={(q.g-0.2>0).mean()*100:3.0f}%  longs={ (q.d>0).sum()} shorts={(q.d<0).sum()}")
    t = pd.to_datetime(df.t, unit="ms"); print("  share of 2025-26 trades below the 200d:", f"{(df[df.per=='2025-26'].reg<0).mean()*100:.0f}%")

# Study 7 (Nov 23 night): VWAP + EMA9 + EMA21, RSI confirmation. Rules in memory/overhaul-plan.md.
import numpy as np, pandas as pd
from lib import *
import study6_lib as L
res = []
for cname, s, (stop, tgt, mb) in [("5m", load("k5"), (0.5, 1.0, 48)), ("15m", load("k15"), (1.0, 2.0, 32))]:
    vw, okday = L.vwap(s); r = L.rsi(s.c).values; c = pd.Series(s.c)
    e9 = c.ewm(span=9, adjust=False).mean().values; e21 = c.ewm(span=21, adjust=False).mean().values; p = lambda a: np.roll(a, 1)
    xu = (e9 > e21) & (p(e9) <= p(e21)); xd = (e9 < e21) & (p(e9) >= p(e21))
    rc = {"none": (np.ones(s.n, bool), np.ones(s.n, bool)), "RSI>50": (r > 50, r < 50), "RSI50-70": ((r > 50) & (r <= 70), (r < 50) & (r >= 30))}
    for k, (lo, sh) in rc.items():
        lg = xu & (s.c > vw) & okday & lo; st = xd & (s.c < vw) & okday & sh
        res.append(L.run(f"X cross {cname} VWAP+{k}", s, lg | st, np.where(lg, 1, np.where(st, -1, 0)), stop, tgt, mb))
    for k in ["none", "RSI>50"]:
        lo, sh = rc[k]
        lg = (e9 > e21) & (s.c > vw) & (s.l <= e21) & (s.c > e9) & okday & lo; st = (e9 < e21) & (s.c < vw) & (s.h >= e21) & (s.c < e9) & okday & sh
        res.append(L.run(f"P pullback {cname} VWAP+{k}", s, lg | st, np.where(lg, 1, np.where(st, -1, 0)), stop, tgt, mb))
    lo, sh = rc["RSI>50"]; lg = xu & okday & lo; st = xd & okday & sh
    res.append(L.run(f"C control cross {cname} no VWAP +RSI>50", s, lg | st, np.where(lg, 1, np.where(st, -1, 0)), stop, tgt, mb))
print(f"\nvariants run: {L.tries}; passes: {sum(1 for x in res if x.get('ok'))}")

# Study 16 (Nov 24): agent #3 idea 2, 15m extreme taker-CVD reversal. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
raw = pd.read_pickle(f"{SD}/k15.pkl"); s = S(raw); n = s.n
cvd = 2 * raw.tb.values - s.v; cs = pd.Series(cvd); z = ((cs - cs.rolling(2880).mean().shift(1)) / cs.rolling(2880).std().shift(1)).values
ret = (s.c / s.o - 1) * 100; rng_ = (s.h - s.l) / s.c * 100; rmed = pd.Series(rng_).rolling(2880).median().shift(1).values
calm = rng_ <= 3 * rmed; valid = np.isfinite(z) & np.isfinite(rmed)
long_sig = valid & calm & (z < -2.5) & (ret < -0.6); short_sig = valid & calm & (z > 2.5) & (ret > 0.6)
def trade(i, d, zexit, cost):
    e = i + 1
    if e + 10 >= n: return None
    ent = s.o[e]; stp = ent * (1 - d * 0.5 / 100)
    for j in range(e, e + 8):
        if (d > 0 and s.l[j] <= stp) or (d < 0 and s.h[j] >= stp): return (-0.5 - cost, j - e + 1)
        if zexit and np.isfinite(z[j]) and ((d > 0 and z[j] >= 0) or (d < 0 and z[j] <= 0)): return (d * (s.o[j + 1] / ent - 1) * 100 - cost, j - e + 2)
    return (d * (s.o[e + 8] / ent - 1) * 100 - cost, 9)
res = []; tries = 0
for sides, zexit in itertools.product(["both", "long only"], [True, False]):
    tries += 1; sig = np.where(long_sig, 1, np.where(short_sig & (sides == "both"), -1, 0))
    for cost in (0.12, 0.20):
        T, R, free = [], [], 0
        for i in np.where(sig != 0)[0]:
            if i + 1 < free: continue
            r = trade(i, int(sig[i]), zexit, cost)
            if r is None: continue
            T.append(s.t[i + 1]); R.append(r[0]); free = i + 1 + r[1]
        pool = np.where(valid)[0]; pool = pool[pool < n - 15]
        def luck(rg, nn, cost=cost, zexit=zexit, sides=sides):
            ii = rg.choice(pool, size=min(nn, len(pool)), replace=False); gg = rg.choice([1] if sides == "long only" else [-1, 1], size=len(ii)); rs = []
            for i, x in zip(ii, gg):
                rr = trade(int(i), int(x), zexit, cost)
                if rr: rs.append(rr[0])
            return np.mean(rs) if rs else np.nan
        o = evaluate(f"P16 CVD reversal {sides} {'z-exit' if zexit else 'fixed2h'} cost{cost}", T, R, luck=luck, min_n=50)
        if cost == 0.12: res.append(o)
print(f"\nvariants run: {tries}; passes at 0.12% cost: {sum(1 for r in res if r.get('ok'))}")

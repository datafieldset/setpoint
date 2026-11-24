# Study 12 (Nov 23 night): liquidation-cascade proxy, delayed entry, fixed hold. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
COST = 0.20; s = load("k5"); res = []; tries = 0
oi = pd.read_pickle(f"{SD}/oi5.pkl"); oi["t"] = ((pd.to_datetime(oi["create_time"]) - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1)).astype("int64")
oi = oi.drop_duplicates("t").set_index("t")["sum_open_interest"].astype(float)
oiv = np.array([oi.get(int(t) + 300000, np.nan) for t in s.t])
dpx = np.full(s.n, np.nan); doi = np.full(s.n, np.nan); dpx[2:] = (s.c[2:] / s.o[:-2] - 1) * 100; doi[2:] = (oiv[2:] / oiv[:-2] - 1) * 100
W = 3
for Y, Z, mode, hold in itertools.product([1.5, 2.5], [0.5, 1.0], ["REVERSAL", "CONTINUATION"], [12, 48]):
    tries += 1
    dn = np.isfinite(dpx) & np.isfinite(doi) & (dpx <= -Y) & (doi <= -Z); up = np.isfinite(dpx) & np.isfinite(doi) & (dpx >= Y) & (doi <= -Z)
    ev = np.where(dn, 1, np.where(up, -1, 0)); fresh = (ev != 0) & (ev != np.roll(ev, 1)); sg = 1 if mode == "REVERSAL" else -1; T, R, free = [], [], 0
    for i in np.where(fresh)[0]:
        e = i + 1 + W
        if e < free: continue
        r = fixed(s, e, int(ev[i]) * sg, hold, COST)
        if r is None: continue
        T.append(s.t[e]); R.append(r); free = e + hold
    pool = np.where(np.isfinite(oiv))[0]; pool = pool[pool < s.n - hold - 10]
    def luck(rng, n, hold=hold):
        ii = rng.choice(pool, size=min(n, len(pool)), replace=False); g = rng.choice([-1, 1], size=len(ii)); rs = [fixed(s, int(i), int(x), hold, COST) for i, x in zip(ii, g)]; rs = [x for x in rs if x is not None]; return np.mean(rs) if rs else np.nan
    res.append(evaluate(f"CASCADE px{Y}% oi-{Z}% {mode} hold{hold*5//60}h", T, R, luck=luck, min_n=40))
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

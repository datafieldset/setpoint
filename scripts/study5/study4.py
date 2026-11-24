# Study 4: five-minute liquidation-cascade proxy. Price move over the last 15 minutes of -Y% (washout, buy) or +Y% (squeeze, sell) while open interest fell Z% over the same 15 minutes.
import itertools, numpy as np, pandas as pd
from lib import *
s = load("k5"); COST = 0.20; tries = 0
oi = pd.read_pickle(f"{SD}/oi5.pkl"); oi["t"] = ((pd.to_datetime(oi["create_time"]) - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1)).astype("int64")
oi = oi.drop_duplicates("t").set_index("t")["sum_open_interest"].astype(float)
# snapshot at time tau belongs to the bar that CLOSES at tau (opens at tau - 5m)
oiv = np.array([oi.get(int(t) + 300000, np.nan) for t in s.t]); print("bars with open interest:", int(np.isfinite(oiv).sum()), "of", s.n, "| from", pd.to_datetime(s.t[np.isfinite(oiv)][0], unit="ms").date())
dpx = np.full(s.n, np.nan); doi = np.full(s.n, np.nan)
dpx[2:] = (s.c[2:] / s.o[:-2] - 1) * 100; doi[2:] = (oiv[2:] / oiv[:-2] - 1) * 100
def run(side, Y, Z, stop, tgt):
    global tries; tries += 1
    d = 1 if side == "WASHOUT" else -1
    cond = (dpx <= -Y) if d > 0 else (dpx >= Y); cond = cond & (doi <= -Z); idx = np.where(cond)[0]
    T, R, free = [], [], 0
    for k in idx:
        if k < free or k + 2 >= s.n: continue
        r = bracket(s, k + 1, d, stop, tgt, 48, COST)
        if r is None: continue
        T.append(s.t[k + 1]); R.append(r[0]); free = k + 1 + r[1] + 1
    pool = np.where(np.isfinite(oiv))[0]; pool = pool[pool < s.n - 60]
    def luck(rng, n):
        rs = []
        for i in rng.choice(pool, size=min(n, len(pool)), replace=False):
            r = bracket(s, int(i) + 1, d, stop, tgt, 48, COST)
            if r: rs.append(r[0])
        return np.mean(rs) if rs else np.nan
    return evaluate(f"{side} px{'-' if d>0 else '+'}{Y}% oi-{Z}% stop{stop}/tgt{tgt}", T, R, luck=luck, min_n=50)
res = [run(side, Y, Z, st, tg) for side, Y, Z, (st, tg) in itertools.product(["WASHOUT", "SQUEEZE"], [1.0, 1.5], [0.5, 1.0], [(1.0, 2.0), (1.5, 3.0)])]
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

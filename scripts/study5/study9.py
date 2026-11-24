# Study 9 (Nov 23 night): funding rate, positioning ratios, perp basis on 5m BTC. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
COST = 0.20; tries = 0; s = load("k5"); res = []
def run(name, ev, hold, pool):
    """ev: list of (entry bar index, direction). One trade at a time."""
    global tries; tries += 1
    T, R, free = [], [], 0
    for i, d in sorted(ev):
        if i < free: continue
        r = fixed(s, i, d, hold, COST)
        if r is None: continue
        T.append(s.t[i]); R.append(r); free = i + hold
    def luck(rng, n):
        ii = rng.choice(pool, size=min(n, len(pool)), replace=False); sg = rng.choice([-1, 1], size=len(ii))
        rs = [fixed(s, int(i), int(g), hold, COST) for i, g in zip(ii, sg)]; rs = [x for x in rs if x is not None]; return np.mean(rs) if rs else np.nan
    res.append(evaluate(name, T, R, luck=luck, min_n=50))
def zfirst(z, thr_hi, thr_lo):
    hi = np.isfinite(z) & (z >= thr_hi); lo = np.isfinite(z) & (z <= -thr_lo)
    return hi & ~np.roll(hi, 1), lo & ~np.roll(lo, 1)
# F. funding
fd = pd.read_pickle(f"{SD}/fund.pkl"); fd["t"] = fd.calc_time.astype("int64"); fd = fd.drop_duplicates("t").sort_values("t").reset_index(drop=True)
fr = fd.last_funding_rate.astype(float); fz = ((fr - fr.rolling(90).mean().shift(1)) / fr.rolling(90).std().shift(1)).values
pool = np.arange(500, s.n - 200)
for thr, mode, hold in itertools.product([1.5, 2.0], ["FADE", "CONT"], [24, 96]):
    ev = []
    for k in range(len(fd)):
        if not np.isfinite(fz[k]) or abs(fz[k]) < thr: continue
        i = s.idx.get(int(fd.t[k]));
        if i is None: continue
        d = (1 if fz[k] > 0 else -1) * (-1 if mode == "FADE" else 1); ev.append((i, d))
    run(f"F funding z{thr} {mode} hold{hold*5//60}h", ev, hold, pool)
# L. positioning ratios (5m snapshots belong to the bar that closes at the snapshot time)
oi = pd.read_pickle(f"{SD}/oi5.pkl"); oi["t"] = ((pd.to_datetime(oi["create_time"]) - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1)).astype("int64"); oi = oi.drop_duplicates("t").set_index("t")
def onbars(series): return np.array([series.get(int(t) + 300000, np.nan) for t in s.t])
def bandz(x, w): p = pd.Series(x); return ((p - p.rolling(w, min_periods=w // 2).mean().shift(1)) / p.rolling(w, min_periods=w // 2).std().shift(1)).values
def events(z, thr, mode):
    hi, lo = zfirst(z, thr, thr); sg = -1 if mode == "FADE" else 1; ev = [(int(i) + 1, sg) for i in np.where(hi)[0]] + [(int(i) + 1, -sg) for i in np.where(lo)[0]]; return [e for e in ev if e[0] < s.n]
for col, label in [("sum_toptrader_long_short_ratio", "top-trader L/S"), ("count_long_short_ratio", "all-accounts L/S")]:
    zz = bandz(onbars(oi[col].astype(float)), 2016); pl = np.where(np.isfinite(zz))[0]; pl = pl[pl < s.n - 100]
    for mode, hold in itertools.product(["FADE", "CONT"], [12, 48]):
        run(f"L {label} z2 {mode} hold{hold*5//60}h", events(zz, 2.0, mode), hold, pl)
# B. perp basis
pm = pd.read_pickle(f"{SD}/prem5.pkl").set_index("t")["c"].astype(float); pb = np.array([pm.get(int(t), np.nan) for t in s.t]); zz = bandz(pb, 288); pl = np.where(np.isfinite(zz))[0]; pl = pl[pl < s.n - 100]
for thr, mode, hold in itertools.product([2.0, 3.0], ["FADE", "CONT"], [12, 48]):
    run(f"B basis z{thr} {mode} hold{hold*5//60}h", events(zz, thr, mode), hold, pl)
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

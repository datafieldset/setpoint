# Study 15 (Nov 24): agent #3 idea 1, perp-to-spot taker-flow lead-lag on 1-minute klines. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
p = pd.read_pickle(f"{SD}/m1_perp.pkl"); sp = pd.read_pickle(f"{SD}/m1_spot.pkl").set_index("t")
s = S(p); n = s.n
r_p = (s.c / s.o - 1) * 100; so = sp.o.reindex(s.t).values; sc = sp.c.reindex(s.t).values; r_s = (sc / so - 1) * 100
flow = 2 * p.tb.values - s.v; hr = (s.t // 3600000) % 24
df = pd.DataFrame({"flow": flow, "hr": hr}); g = df.groupby("hr").flow
mu = g.transform(lambda x: x.rolling(1800, min_periods=900).mean().shift(1)).values; sdv = g.transform(lambda x: x.rolling(1800, min_periods=900).std().shift(1)).values; z = (flow - mu) / sdv
ret1 = np.r_[np.nan, np.diff(np.log(s.c))] * 100; vol15 = pd.Series(ret1).rolling(15).std().values; day = s.t // 86400000
thr_day = {}; ud = np.unique(day)
for k, d in enumerate(ud):
    if k < 31: continue
    m = (day >= d - 30) & (day < d); v = vol15[m]; v = v[np.isfinite(v)]
    if len(v) > 10000: thr_day[d] = np.quantile(v, 2 / 3)
thr = np.array([thr_day.get(d, np.nan) for d in day]); topvol = np.isfinite(thr) & (vol15 >= thr)
valid = np.isfinite(z) & np.isfinite(r_s)
up = valid & (z > 2.0) & (r_p > 0.15) & (r_s < 0.5 * r_p); dn = valid & (z < -2.0) & (r_p < -0.15) & (r_s > 0.5 * r_p)
sig_all = np.where(up, 1, np.where(dn, -1, 0)); res = []; tries = 0
for usevol, hold in itertools.product([False, True], [5, 10]):
    tries += 1; sig = np.where(topvol, sig_all, 0) if usevol else sig_all
    for cost in (0.12, 0.20):
        T, R, free = [], [], 0
        for i in np.where(sig != 0)[0]:
            e = i + 1
            if e < free or e + hold + 2 >= n: continue
            r = bracket(s, e, int(sig[i]), 0.40, 99.0, hold, cost)
            if r is None: continue
            T.append(s.t[e]); R.append(r[0]); free = e + r[1] + 1
        pool = np.where(valid & (topvol if usevol else True))[0]; pool = pool[(pool > 50000) & (pool < n - 50)]
        def luck(rng, nn, cost=cost, hold=hold):
            ii = rng.choice(pool, size=min(nn, len(pool)), replace=False); gg = rng.choice([-1, 1], size=len(ii)); rs = []
            for i, x in zip(ii, gg):
                rr = bracket(s, int(i) + 1, int(x), 0.40, 99.0, hold, cost)
                if rr: rs.append(rr[0])
            return np.mean(rs) if rs else np.nan
        o = evaluate(f"P15 perp-to-spot vol={'top3rd' if usevol else 'all'} hold{hold}m cost{cost}", T, R, luck=luck, min_n=50)
        if cost == 0.12: res.append(o)
print(f"\nvariants run: {tries}; passes at 0.12% cost: {sum(1 for r in res if r.get('ok'))}")

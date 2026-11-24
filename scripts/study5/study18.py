# Study 18 (Nov 24): agent #4 idea 5, spot vs perp taker-flow divergence on 1-minute klines. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
p = pd.read_pickle(f"{SD}/m1_perp.pkl"); sp = pd.read_pickle(f"{SD}/m1_spot.pkl").set_index("t"); s = S(p); n = s.n
def tfi5(v, tb): f = pd.Series(2 * tb - v); return (f.rolling(5).sum() / pd.Series(v).rolling(5).sum()).values
tp = tfi5(s.v, p.tb.values); sv = sp.v.reindex(s.t).values; stb = sp.tb.reindex(s.t).values; ts = tfi5(sv, stb)
idx5 = np.where((s.t // 60000) % 5 == 4)[0]  # the minute that closes each 5-minute block
def zs(x):
    ser = pd.Series(x[idx5]); return ((ser - ser.rolling(2016).mean().shift(1)) / ser.rolling(2016).std().shift(1)).values
div = zs(ts) - zs(tp); r5 = (s.c[idx5] / s.o[idx5 - 4] - 1) * 100
res = []; tries = 0
for thr, hold in itertools.product([1.5, 2.0], [6, 12]):
    tries += 1; ok = np.isfinite(div)
    long_ = ok & (div > thr) & (r5 <= 0.05); short_ = ok & (div < -thr) & (r5 >= -0.05); sig = np.where(long_, 1, np.where(short_, -1, 0))
    for cost in (0.12, 0.20):
        T, R, free = [], [], 0
        for k in np.where(sig != 0)[0]:
            e = idx5[k] + 1
            if e < free or e + hold * 5 + 2 >= n: continue
            r = bracket(s, e, int(sig[k]), 0.70, 99.0, hold * 5, cost)
            if r is None: continue
            T.append(s.t[e]); R.append(r[0]); free = e + r[1] + 1
        pool = idx5[ok]; pool = pool[pool < n - hold * 5 - 5]
        def luck(rg, nn, cost=cost, hold=hold):
            ii = rg.choice(pool, size=min(nn, len(pool)), replace=False); gg = rg.choice([-1, 1], size=len(ii)); rs = []
            for i, x in zip(ii, gg):
                rr = bracket(s, int(i) + 1, int(x), 0.70, 99.0, hold * 5, cost)
                if rr: rs.append(rr[0])
            return np.mean(rs) if rs else np.nan
        o = evaluate(f"P18 spot-perp divergence >{thr} hold{hold*5}m cost{cost}", T, R, luck=luck, min_n=50)
        if cost == 0.12: res.append(o)
print(f"\nvariants run: {tries}; passes at 0.12% cost: {sum(1 for r in res if r.get('ok'))}")

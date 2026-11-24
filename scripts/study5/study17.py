# Study 17 (Nov 24): agent #3 idea 4, DVOL spike continuation. Rules in memory/overhaul-plan.md.
import os, itertools, numpy as np, pandas as pd
FADE = os.environ.get("FADE") == "1"  # post-hoc mirror: trade AGAINST the hour's direction (study 17b)
from lib import *
dv = pd.read_pickle(f"{SD}/dvol1h.pkl").drop_duplicates("t").set_index("t").c; s = load("k5"); h1 = load("k1h"); n = s.n
res = []; tries = 0
dvt = dv.index.values; d_prev = dv.shift(1); dd = (dv - d_prev)
for thr, hold in itertools.product([4.0, 3.0], [24, 48]):
    tries += 1; sig = []
    for t in dvt:
        if t - 3600000 not in dv.index: continue
        if not (dd.get(t, np.nan) > thr and dv[t] > 50): continue
        i = h1.idx.get(int(t))
        if i is None: continue
        d = np.sign(h1.c[i] - h1.o[i]) * (-1 if FADE else 1)
        if d == 0: continue
        sig.append((int(t) + 3600000, int(d)))
    for cost in (0.12, 0.20):
        T, R, free = [], [], 0
        for tt, d in sig:
            e = s.idx.get(tt)
            if e is None or e < free or e + hold + 2 >= n: continue
            r = bracket(s, e, d, 0.60, 99.0, hold, cost)
            if r is None: continue
            T.append(s.t[e]); R.append(r[0]); free = e + r[1] + 1
        pool = np.array([s.idx[int(t) + 3600000] for t in dvt if int(t) + 3600000 in s.idx]); pool = pool[pool < n - hold - 5]
        def luck(rg, nn, cost=cost, hold=hold):
            ii = rg.choice(pool, size=min(nn, len(pool)), replace=False); gg = rg.choice([-1, 1], size=len(ii)); rs = []
            for i, x in zip(ii, gg):
                rr = bracket(s, int(i), int(x), 0.60, 99.0, hold, cost)
                if rr: rs.append(rr[0])
            return np.mean(rs) if rs else np.nan
        o = evaluate(f"P17{'b FADE' if FADE else ''} DVOL spike >{thr}pts hold{hold*5//60}h cost{cost}", T, R, luck=luck, min_n=40)
        if cost == 0.12: res.append(o)
print(f"\nvariants run: {tries}; passes at 0.12% cost: {sum(1 for r in res if r.get('ok'))}")

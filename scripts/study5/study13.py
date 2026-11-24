# Study 13 (Nov 23 night): research agent #1, idea 1: taker burst then absorption/rejection bar. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
import lib
s = load("k5"); raw = pd.read_pickle(f"{SD}/k5.pkl"); tb = raw.tb.values.astype(float); sell = s.v - tb
ret = np.r_[np.nan, np.diff(np.log(s.c))]; sd5 = pd.Series(ret).rolling(288).std().values * 100; dvol = sd5 * np.sqrt(288)
dv = s.v * s.c; med = pd.Series(dv).rolling(20).median().shift(1).values; ratio = np.where(sell > 0, tb / sell, np.nan)
def run(ratio_thr, need_rej, cost):
    sig = np.zeros(s.n, int); okv = np.isfinite(dvol) & (dvol >= 1.5) & (dvol <= 6.0) & np.isfinite(med)
    for i in range(300, s.n - 40):
        if not okv[i]: continue
        big = dv[i] >= 4 * med[i]
        if not big: continue
        if ratio[i] >= ratio_thr: d, j = -1, i + 1   # buy burst -> short after the rejection bar
        elif ratio[i] > 0 and 1 / ratio[i] >= ratio_thr: d, j = 1, i + 1  # sell burst -> long
        else: continue
        if need_rej:
            if d < 0 and not (s.c[j] < s.o[j] and s.h[j] <= s.h[i]): continue
            if d > 0 and not (s.c[j] > s.o[j] and s.l[j] >= s.l[i]): continue
        sig[j] = d
    T, R, free = [], [], 0
    for j in np.where(sig != 0)[0]:
        e = j + 1
        if e < free or e + 1 >= s.n: continue
        stop, tgt = 2.0 * sd5[j], 1.5 * sd5[j]
        r = bracket(s, e, int(sig[j]), stop, tgt, 36, cost)
        if r is None: continue
        T.append(s.t[e]); R.append(r[0]); free = e + r[1] + 1
    pool = np.where(okv)[0]; pool = pool[pool < s.n - 60]
    def luck(rng, n):
        ii = rng.choice(pool, size=min(n, len(pool)), replace=False); g = rng.choice([-1, 1], size=len(ii)); rs = []
        for i, x in zip(ii, g):
            r = bracket(s, int(i) + 1, int(x), 2.0 * sd5[i], 1.5 * sd5[i], 36, cost)
            if r: rs.append(r[0])
        return np.mean(rs) if rs else np.nan
    return evaluate(f"IDEA1 burst>={ratio_thr} rejection={'yes' if need_rej else 'no'} cost{cost}", T, R, luck=luck, min_n=50)
tries = 0; res = []
for thr, rej in itertools.product([3.5, 2.5], [True, False]):
    tries += 1; res.append(run(thr, rej, 0.12)); run(thr, rej, 0.20)
print(f"\nvariants run: {tries}; passes at 0.12% cost: {sum(1 for r in res if r.get('ok'))}")

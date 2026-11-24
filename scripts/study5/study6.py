# Study 6 (Nov 23 night): VWAP reversion and bounce, EMA50 trend, StochRSI turn. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
COST = 0.20; tries = 0
def rsi(c, n=14):
    d = pd.Series(c).diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)
def stoch(c):
    r = rsi(c); lo = r.rolling(14).min(); hi = r.rolling(14).max(); k = ((r - lo) / (hi - lo) * 100).rolling(3).mean(); return k.values, k.rolling(3).mean().values
def vwap(s):
    day = s.t // 86400000; tp = (s.h + s.l + s.c) / 3; pv = pd.Series(tp * s.v).groupby(day).cumsum().values; vv = pd.Series(s.v).groupby(day).cumsum().values
    mins = ((s.t % 86400000) / 60000); return pv / vv, mins >= 120
def run(name, s, sig, dirs, stop, tgt, mb):
    global tries; tries += 1
    idx = np.where(sig)[0]; T, R, free = [], [], 0
    for k in idx:
        if k < free or k + 2 >= s.n: continue
        r = bracket(s, k + 1, int(dirs[k]), stop, tgt, mb, COST)
        if r is None: continue
        T.append(s.t[k + 1]); R.append(r[0]); free = k + 1 + r[1] + 1
    pool = np.arange(300, s.n - mb - 2)
    def luck(rng, n):
        rs = []
        for i in rng.choice(pool, size=min(n, len(pool)), replace=False):
            r = bracket(s, int(i) + 1, int(rng.choice([-1, 1])), stop, tgt, mb, COST)
            if r: rs.append(r[0])
        return np.mean(rs) if rs else np.nan
    return evaluate(name, T, R, luck=luck, min_n=50)
res = []
for cname, s, (stop, tgt, mb) in [("5m", load("k5"), (0.5, 1.0, 48)), ("15m", load("k15"), (1.0, 2.0, 32))]:
    vw, okday = vwap(s); dev = (s.c / vw - 1) * 100; k, dd = stoch(s.c)
    up = (k > dd) & (np.roll(k, 1) <= np.roll(dd, 1)) & (np.minimum(k, dd) <= 30); dn = (k < dd) & (np.roll(k, 1) >= np.roll(dd, 1)) & (np.maximum(k, dd) >= 70)
    near = lambda a: a | np.roll(a, 1) | np.roll(a, 2)
    upn, dnn = near(up), near(dn); ema = pd.Series(s.c).ewm(span=50, adjust=False).mean().values
    for X, usest in itertools.product([1.0, 1.5], [False, True]):
        lz = (dev <= -X) & okday; sz = (dev >= X) & okday; lf = lz & ~np.roll(lz, 1); sf = sz & ~np.roll(sz, 1)
        if usest: lf &= upn; sf &= dnn
        dirs = np.where(lf, 1, np.where(sf, -1, 0)); res.append(run(f"R reversion {cname} stretch{X}% {'+stoch' if usest else 'plain'}", s, lf | sf, dirs, stop, tgt, mb))
    for usest in [False, True]:
        c3 = np.roll(s.c, 3); vwr = np.roll(vw, 3)
        lb = okday & (s.c > ema) & (s.c > vw) & (s.l <= vw) & (c3 > vwr); sb = okday & (s.c < ema) & (s.c < vw) & (s.h >= vw) & (c3 < vwr)
        if usest: lb &= upn; sb &= dnn
        dirs = np.where(lb, 1, np.where(sb, -1, 0)); res.append(run(f"B bounce {cname} {'+stoch' if usest else 'plain'}", s, lb | sb, dirs, stop, tgt, mb))
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

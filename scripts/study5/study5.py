# Study 5 (Nov 23 night): the simple version. RSI extremes and a moving-average reclaim, with and without a volume spike. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
COST = 0.20; tries = 0
def rsi(c, n=14):
    d = pd.Series(c).diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return (100 - 100 / (1 + up / dn)).values
def run(name, s, sig, d, stop, tgt, maxbars):
    global tries; tries += 1
    idx = np.where(sig)[0]; T, R, free = [], [], 0
    for k in idx:
        if k < free or k + 2 >= s.n: continue
        r = bracket(s, k + 1, d, stop, tgt, maxbars, COST)
        if r is None: continue
        T.append(s.t[k + 1]); R.append(r[0]); free = k + 1 + r[1] + 1
    pool = np.arange(300, s.n - maxbars - 2)
    def luck(rng, n):
        rs = []
        for i in rng.choice(pool, size=min(n, len(pool)), replace=False):
            r = bracket(s, int(i) + 1, d, stop, tgt, maxbars, COST)
            if r: rs.append(r[0])
        return np.mean(rs) if rs else np.nan
    return evaluate(name, T, R, luck=luck, min_n=50)
res = []
for cname, s, vwin, (stop, tgt, mb) in [("5m", load("k5"), 288, (0.5, 1.0, 48)), ("15m", load("k15"), 96, (1.0, 2.0, 32))]:
    r = rsi(s.c); vr = s.v / pd.Series(s.v).rolling(vwin).mean().shift(1).values; spike = vr >= 2
    for usevol, side in itertools.product([False, True], ["long", "short"]):
        d = 1 if side == "long" else -1
        zone = (r <= 25) if d > 0 else (r >= 75); first = zone & ~np.roll(zone, 1)
        sig = first & (spike if usevol else True)
        res.append(run(f"A RSI {cname} {side} {'+vol' if usevol else 'plain'}", s, sig, d, stop, tgt, mb))
s = load("k15"); c = pd.Series(s.c); s20 = c.rolling(20).mean().values; s50 = c.rolling(50).mean().values; vr = s.v / pd.Series(s.v).rolling(96).mean().shift(1).values; spike = vr >= 2
up = s20 > s50; dn = s20 < s50
reclaim_up = up & (s.c > s20) & (np.roll(s.c, 1) < np.roll(s20, 1)); reclaim_dn = dn & (s.c < s20) & (np.roll(s.c, 1) > np.roll(s20, 1))
for usevol, side in itertools.product([False, True], ["long", "short"]):
    d = 1 if side == "long" else -1; base = reclaim_up if d > 0 else reclaim_dn
    res.append(run(f"B MA20/50 reclaim 15m {side} {'+vol' if usevol else 'plain'}", s, base & (spike if usevol else True), d, 1.0, 2.0, 32))
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

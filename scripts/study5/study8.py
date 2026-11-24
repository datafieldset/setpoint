# Study 8 (Nov 23 night): VWAP / EMA9-21 / RSI filters on the Coinbase premium (A) and the Nov 22 flow short (B). Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
import study6_lib as L
COST = 0.20
def feats(s):
    vw, _ = L.vwap(s); c = pd.Series(s.c); e9 = c.ewm(span=9, adjust=False).mean().values; e21 = c.ewm(span=21, adjust=False).mean().values; r = L.rsi(s.c).values
    return dict(V=np.sign(s.c - vw), E=np.sign(e9 - e21), R=np.sign(r - 50))
def sequence(events, endf):
    """events: list of (i, d). returns kept trades (t, ret, d, i) in order, one at a time."""
    out, free = [], 0
    for i, d, t, r, end in events:
        if i < free: continue
        out.append((t, r, d, i)); free = end + 1
    return out
def make_A():
    b = load("k1h"); cb = pd.read_pickle(f"{SD}/cb1h.pkl").drop_duplicates("t").set_index("t")
    cbc = np.array([cb.close.get(t, np.nan) for t in b.t]); ps = pd.Series((cbc / b.c - 1) * 100); Lw = 168
    z = ((ps - ps.rolling(Lw).mean().shift(1)) / ps.rolling(Lw).std().shift(1)).values; H = 24; ev = []
    for i in range(Lw + 1, b.n - H - 2):
        if np.isfinite(z[i]) and abs(z[i]) >= 1.5:
            d = 1 if z[i] > 0 else -1; ev.append((i, d, b.t[i + 1], d * (b.o[i + 1 + H] / b.o[i + 1] - 1) * 100 - COST, i + H))
    return b, ev
def make_B():
    s = load("k15"); raw = pd.read_pickle(f"{SD}/k15.pkl"); net = pd.Series(2 * raw.tb.values - s.v); sv = pd.Series(s.v)
    num = (net.rolling(96).sum() / sv.rolling(96).sum()); m = num.rolling(2880, min_periods=501).mean().shift(1); sd = num.rolling(2880, min_periods=501).std(ddof=0).shift(1); z = ((num - m) / sd).values
    day = s.t // 86400000; dc = pd.Series(s.c).groupby(day).last(); s50 = dc.rolling(50).mean().shift(1)  # mean of the 50 finished days before today
    a = np.array([s50.get(d, np.nan) for d in day]); ev = []
    for i in range(96 * 40, s.n - 700):
        if np.isfinite(z[i]) and np.isfinite(a[i]) and z[i] <= -1.5 and s.c[i] < a[i]:
            r = bracket(s, i + 1, -1, 5.0, 10.0, 672, COST)
            if r: ev.append((i, -1, s.t[i + 1], r[0], i + 1 + r[1]))
    return s, ev
def evalset(name, trades, base_rets):
    if not trades: print(f"{name:52s} n=0"); return dict(ok=False)
    t = [x[0] for x in trades]; r = [x[1] for x in trades]
    def luck(rng, n): return float(np.mean(rng.choice(base_rets, size=min(n, len(base_rets)), replace=False)))
    return evaluate(name, t, r, luck=luck, min_n=50)
res = []
for tag, maker, minn in [("A premium", make_A, 50), ("B flow short", make_B, 50)]:
    s, ev = maker(); F = feats(s); base = sequence(ev, None); base_rets = np.array([x[1] for x in base])
    res.append(evalset(f"{tag} BASE", base, base_rets))
    if tag.startswith("A"):
        res.append(evalset(f"{tag} BASE long only (exploratory)", sequence([e for e in ev if e[1] > 0], None), np.array([x[1] for x in sequence([e for e in ev if e[1] > 0], None)])))
    combos = [(k,) for k in "VER"] + list(itertools.combinations("VER", 2)) + [("V", "E", "R")]
    for ks in combos:
        for mode in ("agree", "against"):
            if len(ks) == 3 and False: pass
            sg = 1 if mode == "agree" else -1
            kept = [e for e in ev if all(F[k][e[0]] * e[1] * sg > 0 for k in ks)]
            res.append(evalset(f"{tag} {'+'.join(ks)} {mode}", sequence(kept, None), base_rets))
filt = [x for x in res if x.get('name') and 'BASE' not in x['name']]
print(f"\nfiltered variants: {len(filt)}; passes: {sum(1 for x in filt if x.get('ok'))}")

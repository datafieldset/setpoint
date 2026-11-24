# Study 14 step 2: repeated-size taker flow (agent #2 idea A). Rules in memory/overhaul-plan.md.
import glob, os, numpy as np, pandas as pd
from lib import *
files = sorted(glob.glob(f"{SD}/agg/*.pkl")); print("months:", [os.path.basename(f)[:-4] for f in files])
Ms, Bs, scores = [], [], []
for f in files:
    M, B, G = pd.read_pickle(f); Ms.append(M); Bs.append(B)
    G = G[G.nmin >= 0]; a = G.copy(); a["w"] = a.b; b2 = G.copy(); b2["w"] = b2.b + 1
    W = pd.concat([a, b2]).groupby(["w", "q", "side"], sort=False).agg(n=("n", "sum"), nmin=("nmin", "sum"), qs=("qs", "sum")).reset_index()
    W = W[(W.n >= 10) & (W.nmin >= 7)]
    scores.append(W)
    print(os.path.basename(f), "qualifying group-windows:", len(W))
M = pd.concat(Ms).groupby("min").agg(first=("first", "first"), last=("last", "last")).reset_index().sort_values("min").set_index("min")
B = pd.concat(Bs).groupby("b").q.sum(); W = pd.concat(scores)
tot = B.rename("tot"); wid = np.arange(B.index.min() + 1, B.index.max() + 1)
total = pd.Series(B.reindex(wid).values + B.reindex(wid - 1).values, index=wid)
W["score"] = W.qs.values / total.reindex(W.w.values).values
W = W.sort_values(["w", "score"], ascending=[True, False]); top = W.groupby("w").head(2)
best = top.groupby("w").nth(0).set_index("w"); second = top.groupby("w").nth(1).set_index("w")
sc = pd.Series(0.0, index=wid); sd = pd.Series(0, index=wid)
sc.loc[best.index] = best.score.values; sd.loc[best.index] = best.side.values
tie = best.join(second, rsuffix="2", how="left"); tied = tie[(tie.score2 == tie.score) & (tie.side2 != tie.side)].index; sd.loc[tied] = 0
vals = sc.values; cand = np.where((vals > 0) & (sd.values != 0))[0]; thr = np.full(len(vals), np.nan)
for i in cand:
    if i >= 8640: thr[i] = np.quantile(vals[i - 8640:i], 0.998)
def px(minute, col="first"): return M[col].reindex(minute).values
res = {}
rows = []
for i in cand:
    if not np.isfinite(thr[i]) or not vals[i] > thr[i]: continue
    w = wid[i]; Tmin = (w + 1) * 5  # window end in minutes
    p0 = M["first"].get((w - 1) * 5, np.nan); p1 = M["last"].get(Tmin - 1, np.nan)
    if not (np.isfinite(p0) and np.isfinite(p1)) or abs(p1 / p0 - 1) * 1e4 > 10: continue
    rows.append((Tmin, int(sd.values[i])))
print("signals before the one-trade rule:", len(rows))
def trades(cost):
    T, R, free = [], [], 0
    for Tmin, d in rows:
        e, x = Tmin + 1, Tmin + 61
        if e < free: continue
        a, b = M["first"].get(e, np.nan), M["first"].get(x, np.nan)
        if not (np.isfinite(a) and np.isfinite(b)): continue
        T.append(e * 60000); R.append(d * (b / a - 1) * 100 - cost); free = x
    return T, R
allm = M.index.values; ok = allm[(allm % 5 == 0)]; ok = ok[(ok > allm.min() + 600) & (ok < allm.max() - 100)]
def luck_factory(cost):
    def luck(rng, n):
        ii = rng.choice(ok, size=min(n, len(ok)), replace=False); g = rng.choice([-1, 1], size=len(ii)); rs = []
        for t, x in zip(ii, g):
            a, b = M["first"].get(t + 1, np.nan), M["first"].get(t + 61, np.nan)
            if np.isfinite(a) and np.isfinite(b): rs.append(x * (b / a - 1) * 100 - cost)
        return np.mean(rs) if rs else np.nan
    return luck
for cost in (0.12, 0.20):
    T, R = trades(cost); evaluate(f"A repeated-size flow cost{cost}", T, R, luck=luck_factory(cost), min_n=50)
T, R = trades(0.0); R = np.array(R); T = np.array(T); print("gross avg %:", R.mean() if len(R) else None, "n", len(R), "win(gross)", (R > 0).mean() * 100 if len(R) else None)
print("random-time gross:", np.mean([luck_factory(0.0)(np.random.default_rng(k), max(len(R), 50)) for k in range(5)]))

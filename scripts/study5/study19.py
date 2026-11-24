# Study 19 step 2: screens on the sampled OKX book days (rules in memory/overhaul-plan.md, Nov 24). SD env needed.
import os, glob, numpy as np, pandas as pd
SD = os.environ["SD"]; COST = 0.12
p = pd.read_pickle(f"{SD}/m1_perp.pkl"); p["m"] = p.t // 60000; p = p.set_index("m")
days = sorted(glob.glob(f"{SD}/okx/*.pkl")); res = {"S1_5": [], "S1_15": [], "S1_30": [], "S2": [], "flow_ctrl": []}
cand = []  # S2 candidates (for the 95th pct threshold)
def fwd(m, d, H):
    if m + 1 not in p.index or m + 1 + H not in p.index: return None
    return d * (p.o[m + 1 + H] / p.o[m + 1] - 1) * 100
for fp in days:
    day = os.path.basename(fp)[:-4]; b = pd.read_pickle(fp).set_index("min").sort_index()
    b = b.reindex(range(b.index.min(), b.index.max() + 1)).ffill()
    I = (b.b25 - b.a25) / (b.b25 + b.a25); z = (I - I.rolling(60).mean()) / I.rolling(60).std()
    # S1
    for H in (5, 15, 30):
        free = 0
        for m in b.index:
            if m < free or np.isnan(z[m]): continue
            d = 1 if z[m] >= 2 else -1 if z[m] <= -2 else 0
            if not d: continue
            r = fwd(m, d, H)
            if r is None: continue
            res[f"S1_{H}"].append((day, r)); free = m + 1 + H
    # S2 on 5-minute grid
    spread = (b.ba - b.bb) / b.mid * 1e4
    free = 0
    for m in b.index:
        if m % 5 or m < b.index.min() + 25 or m < free: continue
        a_now = b.a25.loc[m - 4:m].median(); a_base = b.a25.loc[m - 19:m - 5].median()
        b_now = b.b25.loc[m - 4:m].median(); b_base = b.b25.loc[m - 19:m - 5].median()
        ar, br = a_now / a_base, b_now / b_base
        w = p.loc[m - 4:m]; flow = (2 * w.tb.sum() - w.v.sum()) / w.v.sum()
        rng = (b.mid.loc[m - 4:m].max() - b.mid.loc[m - 4:m].min()) / b.mid[m] * 1e4
        if rng > 10 or spread[m] > 2: continue
        for d, thin, other, fl in ((1, ar, br, flow), (-1, br, ar, -flow)):
            if fl >= 0.20 and other >= 0.80:
                r = fwd(m, d, 30)
                if r is None: continue
                res["flow_ctrl"].append((day, r))
                if thin <= 0.35: cand.append((day, r, 1 - thin))
def rep(name, rows):
    if not rows: print(f"{name}: no trades"); return
    df = pd.DataFrame(rows, columns=["day", "r"] + (["s"] if len(rows[0]) == 3 else []))
    pd_ = df.groupby("day").r.mean(); print(f"{name}: n={len(df)} gross {df.r.mean():+.3f}% net {df.r.mean()-COST:+.3f}% win-net {(df.r-COST>0).mean():.0%} days+ {(pd_-COST>0).mean():.0%} of {len(pd_)}")
for k in ("S1_5", "S1_15", "S1_30", "flow_ctrl"): rep(k, res[k])
if cand:
    thr = np.percentile([c[2] for c in cand], 95); rep("S2 all thin-side cands", cand); rep("S2 (score>=95th pct)", [c for c in cand if c[2] >= thr])
else: print("S2: no candidates")
print("days", len(days))

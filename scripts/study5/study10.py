# Study 10 (Nov 23 night): decay diagnostic and stack of the premium (follow) and all-accounts positioning (fade) leads. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
COST = 0.20; s = load("k1h"); res = []
cb = pd.read_pickle(f"{SD}/cb1h.pkl").drop_duplicates("t").set_index("t"); cbc = np.array([cb.close.get(t, np.nan) for t in s.t]); ps = pd.Series((cbc / s.c - 1) * 100)
zp = ((ps - ps.rolling(168).mean().shift(1)) / ps.rolling(168).std().shift(1)).values
oi = pd.read_pickle(f"{SD}/oi5.pkl"); oi["t"] = ((pd.to_datetime(oi["create_time"]) - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1)).astype("int64"); oi = oi.drop_duplicates("t").set_index("t")
r5 = oi["count_long_short_ratio"].astype(float); full = r5.reindex(np.arange(r5.index.min(), r5.index.max() + 1, 300000)); zr5 = ((full - full.rolling(2016, min_periods=1000).mean().shift(1)) / full.rolling(2016, min_periods=1000).std().shift(1))
zl = np.array([zr5.get(int(t) + 3600000, np.nan) for t in s.t])  # value at the close of the hourly bar
def gross_by_half_year():
    print("DIAGNOSTIC gross % per trade by half-year (cost not subtracted)")
    pts = {}
    for name, sig, H in [("premium follow 24h z1.5", np.where(np.isfinite(zp) & (np.abs(zp) >= 1.5), np.sign(zp), 0), 24), ("positioning fade 4h z2", np.where(np.isfinite(zl) & (np.abs(zl) >= 2), -np.sign(zl), 0), 4)]:
        free, out = 0, []
        for i in range(s.n - H - 2):
            if i < free or sig[i] == 0: continue
            out.append((s.t[i + 1], sig[i] * (s.o[i + 1 + H] / s.o[i + 1] - 1) * 100)); free = i + 1 + H
        df = pd.DataFrame(out, columns=["t", "g"]); d = pd.to_datetime(df.t, unit="ms"); df["hy"] = d.dt.year.astype(str) + "H" + ((d.dt.month > 6) + 1).astype(str)
        g = df.groupby("hy").g.agg(["size", "mean"]).round(2); print(name); print(" ".join(f"{k}:{v['mean']:+.2f}({int(v['size'])})" for k, v in g.iterrows()))
gross_by_half_year()
print("\nSTACK")
tries = 0
for zp_thr, zl_thr, H in itertools.product([1.0, 1.5], [1.0, 1.5], [4, 24]):
    tries += 1
    up = np.isfinite(zp) & np.isfinite(zl) & (zp >= zp_thr) & (zl <= -zl_thr); dn = np.isfinite(zp) & np.isfinite(zl) & (zp <= -zp_thr) & (zl >= zl_thr)
    ev = np.where(up, 1, np.where(dn, -1, 0)); fresh = (ev != 0) & (ev != np.roll(ev, 1)); T, R, free = [], [], 0
    for i in np.where(fresh)[0]:
        if i < free: continue
        r = fixed(s, i + 1, int(ev[i]), H, COST)
        if r is None: continue
        T.append(s.t[i + 1]); R.append(r); free = i + 1 + H
    pool = np.where(np.isfinite(zl))[0]; pool = pool[pool < s.n - H - 3]
    def luck(rng, n, H=H):
        ii = rng.choice(pool, size=min(n, len(pool)), replace=False); sg = rng.choice([-1, 1], size=len(ii)); rs = [fixed(s, int(i) + 1, int(g), H, COST) for i, g in zip(ii, sg)]; rs = [x for x in rs if x is not None]; return np.mean(rs) if rs else np.nan
    res.append(evaluate(f"STACK prem z>={zp_thr} & pos z>={zl_thr} hold{H}h", T, R, luck=luck, min_n=40))
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

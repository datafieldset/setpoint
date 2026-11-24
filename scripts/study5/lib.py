# Shared pieces for the fifth-signal studies (Nov 23). Rules are in memory/overhaul-plan.md ("Nov 23: fifth-signal studies").
import os, numpy as np, pandas as pd
SD = os.environ.get("SD", "data")
LOCK = int(pd.Timestamp("2025-11-07", tz="UTC").timestamp() * 1000)
ERAS = [("2017-19", "2017-01-01", "2020-01-01"), ("2020-21", "2020-01-01", "2022-01-01"), ("2022", "2022-01-01", "2023-01-01"), ("2023-24", "2023-01-01", "2025-01-01"), ("2025-26", "2025-01-01", "2027-01-01")]
def ms(s): return int(pd.Timestamp(s, tz="UTC").timestamp() * 1000)
class S:  # one price series as numpy arrays
    def __init__(self, df):
        self.t = df.t.values.astype("int64"); self.o = df.o.values.astype(float); self.h = df.h.values.astype(float); self.l = df.l.values.astype(float); self.c = df.c.values.astype(float); self.v = df.v.values.astype(float)
        self.n = len(self.t); self.step = int(np.median(np.diff(self.t)))
        self.idx = {int(x): i for i, x in enumerate(self.t)}
def load(name): return S(pd.read_pickle(f"{SD}/{name}.pkl"))
def fixed(s, i, d, hold, cost):
    """enter at open of bar i, exit at the open of bar i+hold (close of bar i+hold-1). Returns net percent or None."""
    j = i + hold
    if i < 0 or j >= s.n: return None
    return d * (s.o[j] / s.o[i] - 1) * 100 - cost
def bracket(s, i, d, stop_pct, tgt_pct, maxbars, cost):
    """enter at open of bar i; stop/target in percent of entry; stop checked first inside a bar; time exit at close. Returns (net %, bars held) or None."""
    if i < 0 or i + 1 >= s.n: return None
    e = s.o[i]; stp = e * (1 - d * stop_pct / 100); tgt = e * (1 + d * tgt_pct / 100); last = min(s.n - 1, i + maxbars - 1)
    for j in range(i, last + 1):
        lo, hi = s.l[j], s.h[j]
        if d > 0:
            if lo <= stp: return (-stop_pct - cost, j - i + 1)
            if hi >= tgt: return (tgt_pct - cost, j - i + 1)
        else:
            if hi >= stp: return (-stop_pct - cost, j - i + 1)
            if lo <= tgt: return (tgt_pct - cost, j - i + 1)
    return (d * (s.c[last] / e - 1) * 100 - cost, last - i + 1)
def evaluate(name, times, rets, cost_extra_back=0.0, luck=None, min_n=50, quiet=False):
    """times: entry ms (array), rets: net percent per trade at cost 0.20. luck: function(rng)->mean net return of one random draw, or None.
    cost_extra_back: how much cost was inside rets (0.20) so we can also show the 0.10% read."""
    t = np.asarray(times, dtype="int64"); r = np.asarray(rets, dtype=float); n = len(r)
    if n == 0: print(f"{name:58s} n=0"); return dict(name=name, n=0, ok=False)
    avg = r.mean(); win = (r > 0).mean() * 100; k = max(1, int(round(n * 0.05)))
    wo = np.sort(r)[:-k].mean() if n > k else np.nan
    eras = []; era_ok = True
    for lab, a, b in ERAS:
        m = (t >= ms(a)) & (t < ms(b))
        if m.sum() >= 8:
            eras.append(f"{lab} {r[m].mean():+.2f}({m.sum()})")
            if r[m].mean() <= 0: era_ok = False
    mid = np.median(t); h1 = r[t < mid].mean() if (t < mid).any() else np.nan; h2 = r[t >= mid].mean() if (t >= mid).any() else np.nan
    ex = t >= LOCK; exn = int(ex.sum()); exa = r[ex].mean() if exn else np.nan
    lk = np.nan
    if luck is not None:
        rng = np.random.default_rng(7); draws = np.array([luck(rng, n) for _ in range(200)]); draws = draws[~np.isnan(draws)]
        lk = (draws < avg).mean() * 100 if len(draws) else np.nan
    at10 = avg + 0.10
    ok = (n >= min_n and avg > 0 and wo > 0 and era_ok and h1 > 0 and h2 > 0 and (exn == 0 or exa >= 0) and (np.isnan(lk) or lk >= 95))
    if not quiet:
        print(f"{name:58s} n={n:4d} win={win:4.1f}% avg={avg:+.3f}% w/o5%={wo:+.3f} @0.10cost={at10:+.3f} halves={h1:+.2f}/{h2:+.2f} exam={exa:+.2f}({exn}) luck={lk:4.0f} eras: {' '.join(eras)} {'PASS' if ok else ''}")
    return dict(name=name, n=n, avg=avg, ok=ok, lk=lk)

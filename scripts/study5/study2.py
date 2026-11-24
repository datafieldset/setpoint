# Study 2: time of day. Pre-listed windows only (US cash open 9:30 ET, Asia open 9:00 Tokyo, London open 8:00, Sunday evening open 18:00 ET, funding hours),
# continue (CONT) or fade (FADE) the window's move, hold 1h or 4h. Plus one walk-forward control on hour-of-day buckets.
import itertools, datetime as dt, numpy as np, pandas as pd
from zoneinfo import ZoneInfo
from lib import *
s = load("k15"); COST = 0.20; tries = 0
days = pd.date_range("2017-08-20", "2026-11-23", freq="D")
def local(d, tz, hh, mm=0): return int(dt.datetime(d.year, d.month, d.day, hh, mm, tzinfo=ZoneInfo(tz)).timestamp() * 1000)
def wins(kind):
    out = []
    for d in days:
        wd = d.weekday()
        if kind == "US" and wd < 5: out.append(local(d, "America/New_York", 9, 30))
        elif kind == "ASIA" and wd < 5: out.append(local(d, "Asia/Tokyo", 9))
        elif kind == "LON" and wd < 5: out.append(local(d, "Europe/London", 8))
        elif kind == "SUN" and wd == 6: out.append(local(d, "America/New_York", 18))
        elif kind == "FUND": out += [local(d, "UTC", h) for h in (0, 8, 16)]
    return out
def trade(i0, Wb, H, mode, pre):
    """window = Wb bars starting at i0 (pre=False) or Wb bars ending at i0 (pre=True, funding). Entry at the open of the bar after the window (or at i0 for pre)."""
    if pre: a, b, j = i0 - Wb, i0 - 1, i0
    else: a, b, j = i0, i0 + Wb - 1, i0 + Wb
    if a < 0 or j + H * 4 + 1 >= s.n: return None
    mv = (s.c[b] / s.o[a] - 1) * 100
    if mv == 0: return None
    d = (1 if mv > 0 else -1) * (1 if mode == "CONT" else -1)
    r = fixed(s, j, d, H * 4, COST)
    return None if r is None else (s.t[j], r)
def run(kind, W, H, mode):
    global tries; tries += 1
    pre = kind == "FUND"; Wb = W // 15
    out = [trade(s.idx[T], Wb, H, mode, pre) for T in wins(kind) if T in s.idx]; out = [x for x in out if x]
    pool = np.arange(100, s.n - 100)
    def luck(rng, n):
        rs = [trade(int(i), Wb, H, mode, pre) for i in rng.choice(pool, size=n, replace=False)]; rs = [x[1] for x in rs if x]
        return np.mean(rs) if rs else np.nan
    return evaluate(f"{kind} W{W}m H{H}h {mode}", [x[0] for x in out], [x[1] for x in out], luck=luck)
res = []
for kind, Ws in [("US", [30, 60]), ("ASIA", [30, 60]), ("LON", [30, 60]), ("SUN", [60]), ("FUND", [60])]:
    for W, H, m in itertools.product(Ws, [1, 4], ["CONT", "FADE"]): res.append(run(kind, W, H, m))
# walk-forward control: for each test year use only EARLIER years to pick the 3 UTC hours with the biggest average 1h move, trade them in that direction
h1 = load("k1h"); hod = ((h1.t // 3600000) % 24).astype(int); ret = np.full(h1.n, np.nan); ret[:-1] = (h1.o[1:] / h1.o[:-1] - 1) * 100
yr = pd.to_datetime(h1.t, unit="ms").year.values; T = []; R = []
for Y in range(2019, 2027):
    tr = yr < Y; means = np.array([np.nanmean(ret[tr & (hod == h)]) for h in range(24)]); top = np.argsort(-np.abs(means))[:3]
    for h in top:
        m = (yr == Y) & (hod == h) & ~np.isnan(ret); sg = np.sign(means[h])
        T += list(h1.t[m]); R += list(sg * ret[m] - COST)
tries += 1; res.append(evaluate("WALK-FORWARD top-3 hour-of-day buckets, 1h hold", T, R, min_n=50))
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")
# descriptive: average gross 1h move by UTC hour (all years), for the write-up only
g = [np.nanmean(ret[hod == h]) for h in range(24)]
print("avg gross 1h move by UTC hour (%):", " ".join(f"{h:02d}:{v:+.3f}" for h, v in enumerate(g)), "| cost is 0.20")

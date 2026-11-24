# Study 1: scheduled macro releases (CPI, jobs, FOMC). Wait X minutes after the release, trade with (CONT) or against (FADE) the first move, hold H hours.
import itertools, numpy as np
from lib import *; from events import *
s = load("k5"); ev = events(); COST = 0.20; tries = 0
def trade(i0, X, H, mode, filt):
    nb = X // 5; j = i0 + nb
    if j + H * 12 + 1 >= s.n: return None
    mv = (s.c[i0 + nb - 1] / s.o[i0] - 1) * 100
    if abs(mv) < filt or mv == 0: return None
    d = (1 if mv > 0 else -1) * (1 if mode == "CONT" else -1)
    r = fixed(s, j, d, H * 12, COST)
    return None if r is None else (s.t[j], r)
def run(label, times, X, H, mode, filt):
    global tries; tries += 1
    out = [trade(s.idx[T], X, H, mode, filt) for T in times if T in s.idx]; out = [x for x in out if x]
    pool = np.arange(12 * 24 * 30, s.n - 12 * 6)
    def luck(rng, n):
        rs = []
        for i0 in rng.choice(pool, size=n * 6, replace=False):
            x = trade(int(i0), X, H, mode, filt)
            if x: rs.append(x[1])
            if len(rs) >= n: break
        return np.mean(rs) if len(rs) >= n else np.nan
    return evaluate(f"{label} X{X}m H{H}h {mode} f{filt}", [x[0] for x in out], [x[1] for x in out], luck=luck, min_n=40)
sets = {"ALL3": sorted(set(sum(ev.values(), [])))}
print("== pooled (CPI + jobs + FOMC):")
res = [run("ALL3", sets["ALL3"], X, H, m, f) for X, H, m, f in itertools.product([5, 15], [1, 4], ["CONT", "FADE"], [0, 0.3])]
print("== each type alone (exploratory):")
for k in ["CPI", "NFP", "FOMC"]:
    res += [run(k, sorted(ev[k]), X, H, m, f) for X, H, m, f in itertools.product([5, 15], [1, 4], ["CONT", "FADE"], [0, 0.3])]
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")

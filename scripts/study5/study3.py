# Study 3: Coinbase premium (Coinbase BTC-USD close vs Binance BTCUSDT close, hourly), z-score vs its own prior 7 days.
import itertools, numpy as np, pandas as pd
from lib import *
b = load("k1h"); cb = pd.read_pickle(f"{SD}/cb1h.pkl").drop_duplicates("t").set_index("t"); COST = 0.20; tries = 0
cbc = np.array([cb.close.get(t, np.nan) for t in b.t]); prem = (cbc / b.c - 1) * 100
print("hours with both feeds:", int(np.isfinite(prem).sum()), "of", b.n, "| premium median %.3f%%, std %.3f%%" % (np.nanmedian(prem), np.nanstd(prem)))
L = 168; z = np.full(b.n, np.nan)
ps = pd.Series(prem); mu = ps.rolling(L).mean().shift(1); sd = ps.rolling(L).std().shift(1); z = ((ps - mu) / sd).values
def run(thr, H, mode):
    global tries; tries += 1
    T, R, free = [], [], 0
    for i in range(L + 1, b.n - H - 2):
        if i < free or not np.isfinite(z[i]) or abs(z[i]) < thr: continue
        d = (1 if z[i] > 0 else -1) * (1 if mode == "CONT" else -1)
        r = fixed(b, i + 1, d, H, COST)
        if r is None: continue
        T.append(b.t[i + 1]); R.append(r); free = i + 1 + H
    pool = np.where(np.isfinite(z))[0]; pool = pool[(pool > L + 1) & (pool < b.n - H - 3)]
    def luck(rng, n):
        rs = []
        for i in rng.choice(pool, size=n, replace=False):
            d = (1 if z[i] > 0 else -1) * (1 if mode == "CONT" else -1); r = fixed(b, int(i) + 1, d, H, COST)
            if r is not None: rs.append(r)
        return np.mean(rs) if rs else np.nan
    res = evaluate(f"PREMIUM z>={thr} H{H}h {mode}", T, R, luck=luck)
    # sides alone, for the write-up
    Ta, Ra = np.array(T), np.array(R); return res
res = [run(thr, H, m) for thr, H, m in itertools.product([1.5, 2.0], [4, 24], ["CONT", "FADE"])]
print(f"\nvariants run: {tries}; passes: {sum(1 for r in res if r.get('ok'))}")
# descriptive: does the z-score line up with the NEXT hours' move at all? (gross, correlation)
for H in (1, 4, 24):
    f = np.full(b.n, np.nan); f[: -H - 1] = (b.o[1 + H:-0 or None][: b.n - H - 1] / b.o[1: b.n - H] - 1) * 100
    m = np.isfinite(z) & np.isfinite(f); print(f"corr(z, next {H}h move) = {np.corrcoef(z[m], f[m])[0,1]:+.4f} over {m.sum()} hours")

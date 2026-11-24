# Builds memory/data/btc-daily.csv: one row per UTC day of the data we kept re-pulling for studies. Needs SD (the pickles from fetch_data*.py).
import os, pandas as pd, numpy as np
SD = os.environ["SD"]; rd = lambda n: pd.read_pickle(f"{SD}/{n}.pkl")
day = lambda t: pd.to_datetime(t, unit="ms").dt.floor("D")
k = rd("k1h"); k["d"] = day(k.t); g = k.groupby("d")
out = pd.DataFrame({"open": g.o.first(), "high": g.h.max(), "low": g.l.min(), "close": g.c.last(), "volume_btc": g.v.sum(), "taker_buy_share": g.tb.sum() / g.v.sum()})
cb = rd("cb1h"); cb["d"] = day(cb.t); cbc = cb.groupby("d").close.last()
out["coinbase_premium_pct"] = (cbc / out.close - 1) * 100
f = rd("fund"); f["d"] = day(f.calc_time); out["funding_rate_avg"] = f.groupby("d").last_funding_rate.mean()
o = rd("oi5"); o["d"] = pd.to_datetime(o.t).dt.floor("D"); go = o.groupby("d")
out["open_interest_usd"] = go.sum_open_interest_value.last(); out["toptrader_ls_ratio"] = go.sum_toptrader_long_short_ratio.mean(); out["crowd_ls_ratio"] = go.count_long_short_ratio.mean()
pr = rd("prem5"); pr["d"] = day(pr.t); out["perp_premium_avg"] = pr.groupby("d").c.mean()
dv = rd("dvol1h"); dv["d"] = day(dv.t); out["deribit_vol_index"] = dv.groupby("d").c.last()
out = out.round(6); out.index.name = "date"; os.makedirs("memory/data", exist_ok=True); out.to_csv("memory/data/btc-daily.csv"); print(out.shape, out.index.min(), out.index.max()); print(out.tail(2).T)

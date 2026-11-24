# Study 10 (Nov 23 night): decay diagnostic and stack of the premium (follow) and all-accounts positioning (fade) leads. Rules in memory/overhaul-plan.md.
import itertools, numpy as np, pandas as pd
from lib import *
COST = 0.20; s = load("k1h"); res = []
cb = pd.read_pickle(f"{SD}/cb1h.pkl").drop_duplicates("t").set_index("t"); cbc = np.array([cb.close.get(t, np.nan) for t in s.t]); ps = pd.Series((cbc / s.c - 1) * 100)
zp = ((ps - ps.rolling(168).mean().shift(1)) / ps.rolling(168).std().shift(1)).values
oi = pd.read_pickle(f"{SD}/oi5.pkl"); oi["t"] = ((pd.to_datetime(oi["create_time"]) - pd.Timestamp("1970-01-01")) // pd.Timedelta(milliseconds=1)).astype("int64"); oi = oi.drop_duplicates("t").set_index("t")
r5 = oi["count_long_short_ratio"].astype(float); full = r5.reindex(np.arange(r5.index.min(), r5.index.max() + 1, 300000)); zr5 = ((full - full.rolling(2016, min_periods=1000).mean().shift(1)) / full.rolling(2016, min_periods=1000).std().shift(1))
zl = np.array([zr5.get(int(t) + 3600000, np.nan) for t in s.t])  # value at the close of the hourly bar

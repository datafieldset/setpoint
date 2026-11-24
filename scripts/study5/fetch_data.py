# Data for the 5th-signal studies (Nov 23, Na: "run them all"). Writes parquet-free CSV/pickle into $SD (default ./data, not committed).
# Binance spot klines (BTCUSDT, with taker-buy volume) from data.binance.vision monthly zips: 15m and 1h from Aug 2017, 5m from Jan 2020.
# Binance futures "metrics" (open interest, taker long/short volume ratio, 5m) daily zips from Sep 2020.
# Coinbase BTC-USD 1h candles (paged) for the premium study.
import os, io, sys, time, zipfile, datetime as dt, urllib.request, concurrent.futures as cf, json
import pandas as pd
SD = os.environ.get("SD", "data"); os.makedirs(SD, exist_ok=True)
def get(url, tries=4):
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "setpoint-study"}), timeout=60) as r: return r.read()
        except Exception as e:
            if k == tries - 1: return None
            time.sleep(1 + k)
def months(start, end):
    y, m = start
    while (y, m) <= end:
        yield y, m
        m += 1
        if m == 13: y, m = y + 1, 1
now = dt.datetime.utcnow()
COLS = ["t","o","h","l","c","v","ct","qv","n","tb","tqb","ig"]
def kl_month(iv, y, m):
    b = get(f"https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/{iv}/BTCUSDT-{iv}-{y}-{m:02d}.zip")
    if b is None: return None
    z = zipfile.ZipFile(io.BytesIO(b)); df = pd.read_csv(z.open(z.namelist()[0]), header=None, names=COLS)
    t = df["t"].astype("int64"); t = t.where(t < 1e14, t // 1000); df["t"] = t
    return df[["t","o","h","l","c","v","tb"]]
def klines(iv, start):
    ms = list(months(start, (now.year, now.month)))
    with cf.ThreadPoolExecutor(8) as ex: parts = list(ex.map(lambda ym: kl_month(iv, *ym), ms))
    parts = [p for p in parts if p is not None]
    # the current month has no zip yet: use the API
    last = max(p["t"].max() for p in parts); rows = []; t = int(last) + 1
    while True:
        r = get(f"https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval={iv}&startTime={t}&limit=1000")
        k = json.loads(r) if r else []
        if not k: break
        rows += [[x[0], x[1], x[2], x[3], x[4], x[5], x[9]] for x in k]; t = k[-1][0] + 1
        if len(k) < 1000: break
    if rows:
        parts.append(pd.DataFrame(rows, columns=["t","o","h","l","c","v","tb"]).astype(float))
    df = pd.concat(parts).drop_duplicates("t").sort_values("t").reset_index(drop=True)
    return df.astype({"t": "int64"})
if __name__ == "__main__":
    which = sys.argv[1:] or ["15m", "1h", "5m", "oi", "cb"]
    if "15m" in which: df = klines("15m", (2017, 8)); df.to_pickle(f"{SD}/k15.pkl"); print("15m", len(df), pd.to_datetime(df.t.iloc[0], unit="ms"), pd.to_datetime(df.t.iloc[-1], unit="ms"))
    if "1h" in which: df = klines("1h", (2017, 8)); df.to_pickle(f"{SD}/k1h.pkl"); print("1h", len(df))
    if "5m" in which: df = klines("5m", (2020, 1)); df.to_pickle(f"{SD}/k5.pkl"); print("5m", len(df))
    if "oi" in which:
        days = [dt.date(2020, 9, 1) + dt.timedelta(d) for d in range((now.date() - dt.date(2020, 9, 1)).days)]
        def one(d):
            b = get(f"https://data.binance.vision/data/futures/um/daily/metrics/BTCUSDT/BTCUSDT-metrics-{d}.zip")
            if b is None: return None
            return pd.read_csv(zipfile.ZipFile(io.BytesIO(b)).open(f"BTCUSDT-metrics-{d}.csv"))
        with cf.ThreadPoolExecutor(10) as ex: parts = [p for p in ex.map(one, days) if p is not None]
        df = pd.concat(parts); df["t"] = (pd.to_datetime(df["create_time"]).astype("int64") // 10**6) if df["create_time"].dtype == object else df["create_time"]
        df.to_pickle(f"{SD}/oi5.pkl"); print("oi", len(df), list(df.columns))
    if "cb" in which:
        rows = {}; t = dt.datetime(2017, 8, 17); step = dt.timedelta(hours=300)
        def page(s):
            e = min(s + step, now)
            b = get(f"https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start={s.isoformat()}Z&end={e.isoformat()}Z")
            return json.loads(b) if b else []
        starts = []; s = t
        while s < now: starts.append(s); s += step
        with cf.ThreadPoolExecutor(4) as ex:
            for res in ex.map(page, starts):
                for c in res: rows[c[0]] = c
        df = pd.DataFrame(sorted(rows.values()), columns=["ts","low","high","open","close","vol"]); df["t"] = df["ts"] * 1000
        df.to_pickle(f"{SD}/cb1h.pkl"); print("cb1h", len(df), pd.to_datetime(df.t.iloc[0], unit="ms"))

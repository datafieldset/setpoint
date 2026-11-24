# Data for studies 15 and 17 (Nov 24): Binance spot and USDT-M perp 1-minute klines (with taker buy volume) and Deribit hourly DVOL.
import io, zipfile, json, concurrent.futures as cf, pandas as pd
from fetch_data import get, months, SD, now
COLS = ["t","o","h","l","c","v","ct","qv","n","tb","tqb","ig"]
def kl(kind, ym):
    base = "spot" if kind == "spot" else "futures/um"
    b = get(f"https://data.binance.vision/data/{base}/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-{ym[0]}-{ym[1]:02d}.zip")
    if b is None: return None
    z = zipfile.ZipFile(io.BytesIO(b)); df = pd.read_csv(z.open(z.namelist()[0]), header=None, names=COLS, skiprows=lambda i: False)
    df = df[pd.to_numeric(df.t, errors="coerce").notna()]; df["t"] = df["t"].astype("int64"); df["t"] = df["t"].where(df["t"] < 1e14, df["t"] // 1000)
    return df[["t","o","h","l","c","v","tb"]].astype({"o": float, "h": float, "l": float, "c": float, "v": float, "tb": float})
for kind, start in [("perp", (2019, 9)), ("spot", (2019, 9))]:
    ms = list(months(start, (now.year, now.month)))
    with cf.ThreadPoolExecutor(6) as ex: parts = [p for p in ex.map(lambda ym: kl(kind, ym), ms) if p is not None]
    df = pd.concat(parts).drop_duplicates("t").sort_values("t").reset_index(drop=True); df.to_pickle(f"{SD}/m1_{kind}.pkl"); print(kind, len(df), pd.to_datetime(df.t.iloc[0], unit="ms"), pd.to_datetime(df.t.iloc[-1], unit="ms"))
rows = {}; t = int(pd.Timestamp("2021-03-01", tz="UTC").timestamp() * 1000); end = int(now.timestamp() * 1000)
while t < end:
    b = get(f"https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&start_timestamp={t}&end_timestamp={t + 900 * 3600000}&resolution=3600")
    d = json.loads(b)["result"]["data"] if b else []
    for r in d: rows[r[0]] = r
    t += 900 * 3600000
dv = pd.DataFrame(sorted(rows.values()), columns=["t", "o", "h", "l", "c"]); dv.to_pickle(f"{SD}/dvol1h.pkl"); print("dvol", len(dv), pd.to_datetime(dv.t.iloc[0], unit="ms"), pd.to_datetime(dv.t.iloc[-1], unit="ms"))

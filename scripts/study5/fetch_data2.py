# Data for study 9 (Nov 23 night): Binance perpetual funding rate (8h) and 5m premium index klines from data.binance.vision monthly zips.
import io, zipfile, datetime as dt, concurrent.futures as cf, pandas as pd
from fetch_data import get, months, SD, now
def fz(url, name):
    b = get(url)
    if b is None: return None
    z = zipfile.ZipFile(io.BytesIO(b)); return pd.read_csv(z.open(z.namelist()[0]))
ms = list(months((2019, 9), (now.year, now.month)))
with cf.ThreadPoolExecutor(8) as ex:
    f = [x for x in ex.map(lambda ym: fz(f"https://data.binance.vision/data/futures/um/monthly/fundingRate/BTCUSDT/BTCUSDT-fundingRate-{ym[0]}-{ym[1]:02d}.zip", ""), ms) if x is not None]
fd = pd.concat(f); fd.to_pickle(f"{SD}/fund.pkl"); print("funding", len(fd), list(fd.columns), fd.iloc[0].tolist(), fd.iloc[-1].tolist())
ms = list(months((2020, 1), (now.year, now.month)))
def pk(ym):
    df = fz(f"https://data.binance.vision/data/futures/um/monthly/premiumIndexKlines/BTCUSDT/5m/BTCUSDT-5m-{ym[0]}-{ym[1]:02d}.zip", "")
    if df is None: return None
    df = df.iloc[:, :5]; df.columns = ["t", "o", "h", "l", "c"]; df = df[pd.to_numeric(df.t, errors="coerce").notna()].astype({"t": "int64"}); return df
with cf.ThreadPoolExecutor(8) as ex: p = [x for x in ex.map(pk, ms) if x is not None]
pi = pd.concat(p); pi["t"] = pi["t"].where(pi["t"] < 1e14, pi["t"] // 1000); pi = pi.drop_duplicates("t").sort_values("t"); pi.to_pickle(f"{SD}/prem5.pkl"); print("premium index 5m", len(pi), pd.to_datetime(pi.t.iloc[0], unit="ms"), pd.to_datetime(pi.t.iloc[-1], unit="ms"))

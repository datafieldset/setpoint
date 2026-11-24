# Do the release dates line up with a volume spike at the release minute? (5m BTC bar volume at the release vs the same clock bar on the 20 nearest non-event weekdays)
import numpy as np, pandas as pd
from lib import *; from events import *
s = load("k5"); ev = events(); alls = set(x for v in ev.values() for x in v)
def spike(T):
    i = s.idx.get(T)
    if i is None: return None
    base = [s.v[s.idx[T - k * 864e5]] for k in range(1, 40) if (T - k * 864e5) in s.idx and (T - k * 864e5) not in alls and pd.Timestamp(T - k * 864e5, unit="ms").weekday() < 5][:20]
    return s.v[i] / np.median(base) if len(base) >= 10 else None
for name, L in ev.items():
    r = [(pd.Timestamp(T, unit="ms").strftime("%Y-%m-%d %H:%MZ"), spike(T)) for T in L]
    ok = [x for x in r if x[1] and x[1] >= 1.8]; bad = [x for x in r if x[1] is None or x[1] < 1.8]
    print(f"{name}: {len(r)} dates, {len(ok)} show a volume spike >= 1.8x (median ratio {np.median([x[1] for x in r if x[1]]):.1f}x)")
    for d, v in bad: print("   no spike:", d, None if v is None else round(v, 2))

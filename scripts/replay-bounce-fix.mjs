// Bounce (Flush Rider) fix study, Nov 22. Plan written to memory/overhaul-plan.md first. BTC_DIR = folder with BTC_5m.json.
import fs from "fs";
const T = await import("../lib/trend.js"), F = await import("../lib/flush.js");
const c5 = JSON.parse(fs.readFileSync((process.env.BTC_DIR || ".") + "/BTC_5m.json"));
const B = T.splitBars(c5, 3600, 300, Date.now() + 1e12).done, pre = T.precompute(B);
const DROP = +(process.env.DROP || 2.5), isFB = (i) => { if (i < 48) return false; const b = B[i]; if (!(b.open > 0) || (b.open - b.low) / b.open < DROP / 100) return false; let lo = Infinity; for (let j = i - 48; j < i; j++) if (B[j].low < lo) lo = B[j].low; return b.low < lo; };
const COST = 0.20, avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN), f = (v) => (isNaN(v) ? "n/a" : (v >= 0 ? "+" : "") + v.toFixed(2));
const eras = [["20-21", 2020, 2021], ["22", 2022, 2022], ["23-24", 2023, 2024], ["25-26", 2025, 2026]];
const LOCK0 = Date.UTC(2025, 10, 7), LOCK1 = Date.UTC(2026, 10, 7);
// walk a long from bar k0 (inclusive): returns { r, end } or null. stop first when both touch.
function walk(k0, E, S, tgt) { const risk = E - S; for (let k = k0; k < Math.min(B.length, k0 + 600); k++) { if (B[k].low <= S) return { r: -1 - (COST / 100) * E / risk, end: k, stopped: true }; if (B[k].high >= tgt) return { r: 3 - (COST / 100) * E / risk, end: k }; } return null; }
// shift: slide the flush bars in time (luck test); flushBars override
function trades(cfg, shift = 0, flushOverride = null) {
  const out = []; let last = -1e9; const idx = flushOverride || [];
  if (!flushOverride) for (let i = 60; i < B.length - 1; i++) { if (!isFB(i) || i - last <= F.FLUSH_COOLDOWN) continue; last = i; idx.push(i); }
  for (const i0 of idx) {
    const i = i0 + shift; if (i < 60 || i >= B.length - 30) continue;
    const atr = pre.atr[i]; if (!(atr > 0)) continue;
    const entry = B[i].low + F.FLUSH_ENTRY_ATR * atr, stop = B[i].low - cfg.stopATR * atr;
    if (((entry - stop) / entry) * 100 < F.FLUSH_MIN_RISK_PCT) continue;
    const tgt = entry + 3 * (entry - stop);
    let fill = -1, deadAt = -1;
    for (let k = i + 1; k <= i + F.FLUSH_WAIT && k < B.length; k++) { if (B[k].low <= stop) { deadAt = k; break; } if (B[k].low <= entry) { fill = k; break; } }
    let retryFrom = -1;
    if (fill > 0) { const w = walk(fill, entry, stop, tgt); if (w) { out.push({ t: B[fill].time, r: w.r, kind: "base", end: w.end }); if (w.stopped) retryFrom = w.end; } }
    else if (deadAt > 0) retryFrom = deadAt;
    if (cfg.retry && retryFrom > 0) {
      for (let j = retryFrom; j <= retryFrom + cfg.retry.win && j < B.length - 2; j++) {
        if (B[j].close > stop && j > retryFrom - 1 && B[j].close > B[j].open) {
          let lo = 1e18; for (let k = i; k <= j; k++) lo = Math.min(lo, B[k].low);
          const E = B[j + 1].open, S = lo - cfg.retry.stopATR * atr; if (!(E > S) || ((E - S) / E) * 100 < F.FLUSH_MIN_RISK_PCT) break;
          const w = walk(j + 1, E, S, E + 3 * (E - S)); if (w) out.push({ t: B[j + 1].time, r: w.r, kind: "retry", end: w.end }); break;
        }
      }
    }
  }
  return out;
}
function show(name, cfg, which = "all") {
  let tr = trades(cfg); if (which !== "all") tr = tr.filter((x) => x.kind === which);
  if (!tr.length) { console.log(name, "no trades"); return; }
  const rs = tr.map((x) => x.r), w = rs.filter((v) => v > 0).length, m = avg(rs), s = rs.slice().sort((a, b) => b - a), cut = Math.floor(s.length * 0.05), trim = avg(s.slice(cut));
  const mid = tr.slice().sort((a, b) => a.t - b.t)[Math.floor(tr.length / 2)].t;
  const era = eras.map(([n, a, b]) => { const z = tr.filter((x) => { const y = new Date(x.t).getUTCFullYear(); return y >= a && y <= b; }); return n + ":" + f(avg(z.map((x) => x.r))) + "(" + z.length + ")"; }).join(" ");
  const ex = tr.filter((x) => x.t >= LOCK0 && x.t < LOCK1), post = tr.filter((x) => x.t >= LOCK1);
  // luck: slide the same flush bars by a random 200 to 3000 bars, same rules, same count of tries
  const flush = trades({ ...cfg, __noop: 1 }, 0, null); // placeholder to keep idx logic simple
  let beat = 0, n = 0; const idx = []; { let last = -1e9; for (let i = 60; i < B.length - 1; i++) { if (!isFB(i) || i - last <= F.FLUSH_COOLDOWN) continue; last = i; idx.push(i); } }
  for (let d = 0; d < 200; d++) { const sh = 200 + Math.floor(Math.random() * 2800) * (Math.random() < 0.5 ? 1 : -1); const x = trades(cfg, sh, idx).filter((q) => which === "all" || q.kind === which).map((q) => q.r); if (x.length < tr.length * 0.6) continue; n++; if (m > avg(x)) beat++; }
  console.log(`${name.padEnd(40)} n=${String(tr.length).padStart(3)} win ${(100 * w / tr.length).toFixed(0)}% ${f(m)}R -best5% ${f(trim)} halves ${f(avg(tr.filter((x) => x.t < mid).map((x) => x.r)))}/${f(avg(tr.filter((x) => x.t >= mid).map((x) => x.r)))} | ${era} | exam n=${ex.length} ${f(avg(ex.map((x) => x.r)))} | luck beats ${n ? (100 * beat / n).toFixed(0) : "?"}% | after Nov 6: ${post.map((x) => new Date(x.t).toISOString().slice(5, 13) + "Z " + x.kind + " " + f(x.r)).join(", ") || "none"}`);
}
if (process.env.ONLY_BASE) { console.log("flush drop " + DROP + "%"); show("BASE rule", { stopATR: 0.75 }); process.exit(0); }
console.log("1h bars", B.length, "to", new Date(B[B.length - 1].time).toISOString().slice(0, 16), "| cost", COST + "%");
show("BASE (current Bounce rule)", { stopATR: 0.75 });
for (const s of [1.25, 1.75, 2.5]) show(`A wider stop ${s} ATR`, { stopATR: s });
for (const [win, st] of [[12, 0.25], [24, 0.25], [12, 0.5], [24, 0.5]]) { const c = { stopATR: 0.75, retry: { win, stopATR: st } }; show(`B retry ${win} bars stop ${st} ATR, combined`, c); show(`B retry ${win} bars stop ${st} ATR, retries only`, c, "retry"); }

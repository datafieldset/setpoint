// app/components/meterCss.js
//
// v25.7: the styles for the Market Meter card and the Price vs averages card, in one place so the dashboard and the public
// /watch page draw them from the same rules (they used to live inside app/page.jsx).
export const METER_VARS = `
:root{
  --green:#00D179; --green-soft:#5EE9AE; --green-dim:rgba(0,209,121,.14);
  --red:#FF5C6C; --red-soft:#FF9AA3; --red-dim:rgba(255,92,108,.13);
  --amber:#F5B851; --amber-dim:rgba(245,184,81,.13);
  --ink:#080B0A; --panel:#0F1513; --panel2:#151E1A; --panel3:#1A2621;
  --border:#223029; --hair:rgba(255,255,255,.06);
  --text:#EAF2EE; --soft-text:#C5D3CC; --muted:#93A69D; --dim:#5E7168;
}
*{box-sizing:border-box}
.mono{font-family:'JetBrains Mono',monospace;font-variant-numeric:tabular-nums}
button{font-family:inherit}
`;

export const METER_CSS = `
.w200-panel{padding:10px 12px;border-radius:10px;margin-bottom:12px;border:1px solid var(--border);background:var(--panel)}
.w200-panel.near{border-color:rgba(245,184,81,.4);background:var(--amber-dim)}
.w200-head{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:6px}
.w200-row{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.w200-val{font-size:15px;font-weight:700}
.w200-dist{font-size:11.5px;font-weight:600}
.w200-dist.up{color:var(--muted)}
.w200-dist.down{color:var(--amber)}
.w200-note{color:var(--dim);font-size:10.5px;line-height:1.5;margin-top:7px}
.w200-val.sm{font-size:12.5px}
.w200-panel.dual{padding-bottom:12px}
.cross-tag{font-size:11px;font-weight:700;padding:3px 9px;border-radius:6px;display:inline-block;margin-bottom:10px}
.chart-wrap{position:relative}
.chart-plot{position:relative;margin-bottom:2px}
.chart-plot .cross-chart{margin-bottom:0}
.cross-chart{width:100%;height:90px;display:block;margin-bottom:2px}
.chart-axis{position:relative;height:16px;margin-bottom:8px}
.chart-axis-label{position:absolute;top:0;transform:translateX(-50%);font-size:9.5px;color:var(--dim);white-space:nowrap}
.chart-axis-label:first-child{transform:translateX(0)}
.chart-axis-label:last-child{transform:translateX(-100%)}
.cross-legend{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.cross-legend-item{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px}
.cross-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.cross-dot.fifty{background:var(--green-soft)}
.cross-dot.twohundred{background:var(--muted)}
.p50-chart{height:130px}
.p50-dot.cross-dot{background:var(--amber)}
.p50-dot{position:absolute;width:9px;height:9px;margin:-4.5px 0 0 -4.5px;border-radius:50%;background:var(--text);pointer-events:none}
.cross-dot.p50-price{background:var(--text)}
.cross-dot.p50-line{background:var(--amber)}
.p50-need{font-size:12.5px;color:var(--text);line-height:1.5;margin:2px 0 4px}
.lt-ladder{width:100%;max-width:330px;height:auto;display:block;margin:2px 0}
.lt-tabs{display:flex;gap:3px;background:var(--ink);border:1px solid var(--border);border-radius:10px;padding:3px;margin:4px 0 8px}
.lt-tab{flex:1;min-height:44px;border:0;border-radius:8px;background:transparent;color:var(--muted);font:inherit;font-size:12.5px;line-height:1.15;padding:0 2px;font-weight:500;cursor:pointer;text-wrap:balance}
.lt-tab.on{background:var(--border);color:var(--text);font-weight:700}
.lt-tab:focus-visible,.lt-about:focus-visible{outline:2px solid var(--green-soft);outline-offset:2px}
.lt-legend{font-size:12px;color:var(--text);line-height:1.45;margin-top:2px}
.lt-about{background:none;border:0;padding:0;font:inherit;color:var(--muted);text-decoration:underline;cursor:pointer}
.lt-about-text{margin-top:6px}
.cross-tag.golden{color:var(--green-soft);background:var(--green-dim)}
.cross-tag.death{color:var(--red-soft);background:var(--red-dim)}
.cross-tag.test{color:var(--amber);background:var(--amber-dim)}
.mm-headline{font-family:'Bricolage Grotesque';font-weight:700;font-size:21px;line-height:1.25;margin:2px 0 16px}
.mm-gauge{margin-bottom:10px}
.mm-gauge-bar{position:relative;height:8px;border-radius:6px;background:linear-gradient(90deg,var(--red-soft),var(--panel3) 50%,var(--green-soft))}
.mm-marker{position:absolute;top:-5px;width:6px;height:18px;margin-left:-3px;border-radius:3px;background:var(--text);box-shadow:0 0 0 3px var(--panel2)}
.mm-gauge-bar::after{content:"";position:absolute;left:50%;top:-2px;width:1px;height:12px;background:rgba(255,255,255,.28)}
.mm-gauge-ends{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:8px}
.mm-why-btn{margin-top:12px;background:none;border:none;padding:6px 0;color:var(--muted);font:inherit;font-size:12.5px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.mm-why{margin-top:8px;padding-top:12px;border-top:1px solid var(--hair)}
.mm-panel{padding:14px 16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-bottom:16px}
.mm-panel.confirmed{border-color:rgba(245,184,81,.5);background:linear-gradient(180deg,rgba(245,184,81,.08),var(--panel2))}
.mm-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px}
.mm-title{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.mm-sub{font-size:12px;color:var(--muted)}
.mm-panel{position:relative}
.mm-head-r{display:flex;align-items:center;gap:4px;position:relative}
.mm-share-btn{width:44px;height:44px;margin:-14px -12px -14px 0;display:flex;align-items:center;justify-content:center;background:transparent;border:0;border-radius:10px;cursor:pointer;color:var(--soft-text)}
.mm-share-ic{width:32px;height:32px;display:flex;align-items:center;justify-content:center;border:1px solid #2C3B34;border-radius:9px;background:#1A2621}
.mm-share-btn:hover .mm-share-ic,.mm-share-btn:focus-visible .mm-share-ic{border-color:var(--green)}
.mm-share-btn.open .mm-share-ic{border-color:var(--green);background:#1F2E27;color:var(--text)}
.mm-share-menu{position:absolute;top:34px;right:-4px;z-index:20;width:224px;padding:6px;background:#1B2822;border:1px solid #2C3B34;border-radius:12px;box-shadow:0 12px 32px rgba(0,0,0,.55);display:flex;flex-direction:column}
.mm-share-item{display:flex;align-items:center;gap:12px;height:48px;padding:0 12px;background:transparent;border:0;border-radius:8px;color:var(--text);font:600 14px 'Inter',sans-serif;text-align:left;cursor:pointer}
.mm-share-item:hover,.mm-share-item:focus-visible{background:#24342C}
.mm-share-msg{padding:10px 12px 8px;font-size:13px;line-height:1.4;color:var(--soft-text);border-top:1px solid #2C3B34;margin-top:4px}
.mm-moves{display:grid;grid-template-columns:repeat(auto-fit,minmax(58px,1fr));gap:6px;margin-top:10px}
.mm-move{display:flex;flex-direction:column;gap:2px;min-width:0}
.mm-move-k{font-size:12px;color:var(--muted)}
.mm-move-v{font-size:14px;font-weight:700}
.mm-move-v.up{color:var(--green)}
.mm-move-v.down{color:var(--red)}
.mm-move-flag{grid-column:1/-1;font-size:12px;color:var(--amber);font-weight:600;line-height:1.4}
.mm-synthesis{font-size:15px;font-weight:600;line-height:1.4;color:var(--text);background:var(--panel3);border-left:3px solid var(--amber);border-radius:8px;padding:10px 12px;margin-bottom:14px}
.mm-levels{display:flex;gap:6px;margin-bottom:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--hair)}
.mm-dot{width:100%;height:6px;border-radius:4px;background:var(--panel3)}
.mm-dot.on.up{background:var(--green-soft)}
.mm-dot.on.down{background:var(--red-soft)}
.mm-dot.on.neutral{background:var(--muted)}
.mm-dot.on.extreme{background:var(--amber)}
.mm-level-text{font-family:'Bricolage Grotesque';font-weight:700;font-size:20px;margin-bottom:6px}
.mm-stage{font-size:12.5px;font-weight:400;line-height:1.5;color:var(--text);margin-bottom:2px}
.mm-stage.ending{color:var(--amber)}
.mm-fresh{font-size:13.5px;font-weight:600;line-height:1.45;color:var(--amber);margin:0 0 10px}
.mm-ctx{margin-top:12px;padding-top:12px;border-top:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:10px}
.mm-ctx-i{display:flex;flex-direction:column;gap:2px;min-width:0}
.mm-ctx-k{font-size:12px;color:var(--muted);white-space:nowrap}
.mm-ctx-v{font-size:13.5px;font-weight:600}
.mm-ctx-v.sell{color:var(--red-soft)}
.mm-ctx-v.buy{color:var(--green-soft)}
.mm-ctx-v.quiet{color:var(--muted);font-weight:500}
.mm-ready{margin-top:16px;padding-top:14px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:14px}
.mm-ready-title{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.mm-ready-sig{display:flex;flex-direction:column;gap:8px}
.mm-ready-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
.mm-ready-name{font-size:14px;font-weight:600}
.mm-ready-tf{font-weight:400;color:var(--muted)}
.mm-ready-badge{font-size:13px;font-weight:600;color:var(--muted);white-space:nowrap}
.mm-ready-badge.wait{color:var(--amber)}
.mm-ready-badge.go{color:var(--green)}
.mm-ready-line{display:flex;gap:8px;align-items:flex-start;font-size:13px;line-height:1.4;color:var(--soft-text)}
.mm-ready-line.waiting{color:var(--text);font-weight:600}
.mm-ready-ic{flex:none;margin-top:1px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.mm-scope-note{margin-top:6px;font-size:11px;color:var(--soft-text);line-height:1.4}
.mm-confirm{margin-top:10px;font-size:12px;color:var(--amber);font-weight:600}
.mm-ctx-cells{display:contents}
`;

// Locked (signed-out) look, only used by the public /watch page.
export const METER_LOCK_CSS = `
.mm-ctx.locked{position:relative}
.mm-ctx.locked .mm-ctx-cells{display:contents}
.mm-ctx.locked .mm-ctx-i{filter:blur(6px);user-select:none;pointer-events:none}
.mm-lock-pill{position:absolute;left:0;right:0;top:0;bottom:0;margin:auto;width:max-content;max-width:100%;height:36px;display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--green);border-radius:999px;padding:0 14px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer}
.lt-tab.locked{display:flex;align-items:center;justify-content:center;gap:4px;color:var(--dim)}
`;

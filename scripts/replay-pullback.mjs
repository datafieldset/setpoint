// Pullback-entry replay (Nov 7). Usage: BTC_DIR=<folder with BTC_5m.json and BTC_1d.json> node scripts/replay-pullback.mjs [5m,15m,30m,1h]
// Baseline enters at the breakout; pullback enters on a limit order X ATR below it, waits M bars. Fees: 0.15% round trip (taker) or maker entry+target.
import fs from "fs";
const T = await import("../lib/trend.js");
const c5=JSON.parse(fs.readFileSync((process.env.BTC_DIR||".")+"/BTC_5m.json")), d1=JSON.parse(fs.readFileSync((process.env.BTC_DIR||".")+"/BTC_1d.json"));
const FAR=Date.now()+1e12;
const sma=new Map();{const q=[];let s=0;for(const x of d1){if(q.length===200)s-=q.shift();q.push(x.close);s+=x.close;if(q.length===200)sma.set(Math.floor(x.time/864e5)+1,s/200)}}
const h1=T.splitBars(c5,3600,300,FAR).done,h4=T.splitBars(c5,14400,300,FAR).done,htf=T.makeHtf(h1,h4);
const X=[0.5,1.0], M=[4,8];
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;
const f=(v)=>isNaN(v)?"  n/a ":((v>=0?"+":"")+v.toFixed(3));
const pc=(a)=>a.length?(a.filter(v=>v.r>0).length/a.length*100).toFixed(0)+"%":"-";
const tfs=process.argv[2]?process.argv[2].split(","):["5m","15m","30m","1h"];
let variants=0;
for(const tf of tfs){
  const cfg=T.TREND_TFS[tf];const bars=T.splitBars(c5,cfg.baseSec,300,FAR).done,pre=T.precompute(bars);
  const ev=[];
  for(let i=300;i<bars.length-2;i++){
    const fb=bars[i+1];
    const a=T.analyze(cfg,bars,pre,i,{time:fb.time,open:fb.open,high:fb.high,low:fb.low,close:fb.open},{sma:sma.get(Math.floor(fb.time/864e5)),htf});
    if(!a||!a.bull.fire)continue;
    const e=a.bull;const E=e.entry,S=e.stop,Tg=e.target,r0=E-S,atr=pre.atr[i];
    // baseline: entry bar counts, stop first
    let end=-1,rb=null;
    for(let k=i+1;k<bars.length;k++){const b=bars[k];if(b.low<=S){end=k;rb=-1;break}if(b.high>=Tg){end=k;rb=T.TARGET_R;break}}
    if(end<0)break;
    const ev1={i,t:fb.time,E,S,Tg,r0,atr,rb,riskPct0:r0/E*100,pb:{}};
    for(const x of X)for(const m of M){
      const P=E-x*atr;let fill=-1;
      for(let k=i+2;k<=i+1+m&&k<bars.length;k++){const b=bars[k];if(b.low<=S||b.high>=Tg)break;if(b.low<P){fill=k;break}}
      if(fill<0){ev1.pb[x+"_"+m]=null;continue}
      // variant A: keep original stop and target levels
      const sA=S,tA=Tg;const rpA=(P-sA)/P*100;let rA=null;
      if(bars[fill].low<=sA)rA=-1;else for(let k=fill+1;k<bars.length;k++){const b=bars[k];if(b.low<=sA){rA=-1;break}if(b.high>=tA){rA=(tA-P)/(P-sA);break}}
      // variant C: same geometry (2 ATR stop, 0.75R target) shifted to the pullback price
      const sC=P-r0,tC=P+T.TARGET_R*r0;const rpC=r0/P*100;let rC=null;
      if(bars[fill].low<=sC)rC=-1;else for(let k=fill+1;k<bars.length;k++){const b=bars[k];if(b.low<=sC){rC=-1;break}if(b.high>=tC){rC=T.TARGET_R;break}}
      ev1.pb[x+"_"+m]={A:rA===null?null:{r:rA,rp:rpA},C:rC===null?null:{r:rC,rp:rpC}};
    }
    ev.push(ev1);i=end; // one trade at a time, gated by the baseline trade
  }
  const base=ev.map(e=>({r:e.rb,net:e.rb-0.15/e.riskPct0}));
  console.log(`\n===== ${tf}: ${ev.length} breakout buys (baseline: enter at the breakout) =====`);
  console.log(`baseline: win ${pc(base)}, gross ${f(avg(base.map(b=>b.r)))}R, after fees(0.15%) ${f(avg(base.map(b=>b.net)))}R, avg stop ${(avg(ev.map(e=>e.riskPct0))).toFixed(2)}%`);
  for(const x of X)for(const m of M){
    const key=x+"_"+m;
    for(const V of ["A","C"]){
      variants++;
      const filled=ev.filter(e=>e.pb[key]&&e.pb[key][V]);const missed=ev.filter(e=>!(e.pb[key]&&e.pb[key][V]));
      const rows=filled.map(e=>({r:e.pb[key][V].r,rp:e.pb[key][V].rp,bs:e.rb}));
      const cons=rows.map(q=>q.r-0.15/q.rp);const mk=rows.map(q=>q.r-(q.r>0?0:0.075)/q.rp);
      const h=Math.ceil(rows.length/2);
      console.log(`pullback ${x} ATR, wait ${m} bars, ${V==="A"?"keep stop+target levels":"shift whole trade down"}: fills ${filled.length}/${ev.length} (${(filled.length/ev.length*100).toFixed(0)}%), win ${pc(rows)}, gross ${f(avg(rows.map(q=>q.r)))}, net(taker) ${f(avg(cons))}, net(maker entry+target) ${f(avg(mk))}, halves net(taker) ${f(avg(cons.slice(0,h)))} / ${f(avg(cons.slice(h)))} | baseline on same filled ${f(avg(filled.map(e=>e.rb-0.15/e.riskPct0)))} net, on missed ${f(avg(missed.map(e=>e.rb-0.15/e.riskPct0)))} net (${missed.length})`);
    }
  }
}
console.log("\nvariants tried:",variants);

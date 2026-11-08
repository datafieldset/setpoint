// Exit study (Nov 7). BTC_DIR must hold a merged BTC_5m.json and BTC_1d.json (Jan 2020 to now; merge the two fetch scripts outputs, dedupe by time). Usage: BTC_DIR=<folder> node scripts/replay-exits.mjs
import fs from "fs";
const T = await import("../lib/trend.js");
const D=(process.env.BTC_DIR||".")+"/";
const c5=JSON.parse(fs.readFileSync(D+"BTC_5m.json")), d1=JSON.parse(fs.readFileSync(D+"BTC_1d.json"));
const FAR=Date.now()+1e12;
const sma=new Map();{const q=[];let s=0;for(const x of d1){if(q.length===200)s-=q.shift();q.push(x.close);s+=x.close;if(q.length===200)sma.set(Math.floor(x.time/864e5)+1,s/200)}}
const h1=T.splitBars(c5,3600,300,FAR).done,h4=T.splitBars(c5,14400,300,FAR).done,htf=T.makeHtf(h1,h4);
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN;
const f=v=>isNaN(v)?"   n/a":((v>=0?"+":"")+v.toFixed(3));
const FEE=0.15;
const periods=[["2020-21",2020,2021],["2023-24",2023,2024],["2025-26",2025,2026]];

const tfs=["1h","4h"];
const exits=[["fixed 0.75R (today)",{k:0.75}],["fixed 2R",{k:2}],["fixed 3R",{k:3}],["trail 3 ATR",{tr:3}],["trail 4 ATR",{tr:4}]];
for(const tf of tfs){
  const cfg=T.TREND_TFS[tf];const bars=T.splitBars(c5,cfg.baseSec,300,FAR).done,pre=T.precompute(bars);
  console.log(`\n===== ${tf}: own one-trade-at-a-time gating per exit, fee ${FEE}% round trip, 2 ATR stop =====`);
  for(const [name,x] of exits){
    const tr=[];
    for(let i=300;i<bars.length-2;i++){
      const fb=bars[i+1];
      const a=T.analyze(cfg,bars,pre,i,{time:fb.time,open:fb.open,high:fb.high,low:fb.low,close:fb.open},{sma:sma.get(Math.floor(fb.time/864e5)),htf});
      if(!a||!a.bull.fire)continue;
      const e=a.bull;const E=e.entry,S=e.stop,r0=E-S,atr=pre.atr[i],rp=r0/E*100;
      let r=null,end=-1;
      if(x.k){const Tg=E+x.k*r0;for(let k=i+1;k<bars.length;k++){const b=bars[k];if(b.low<=S){r=-1;end=k;break}if(b.high>=Tg){r=x.k;end=k;break}}}
      else{let t=S,hi=E;for(let k=i+1;k<bars.length;k++){const b=bars[k];if(b.low<=t){r=(t-E)/r0;end=k;break}if(b.high>hi){hi=b.high;const nt=hi-x.tr*atr;if(nt>t)t=nt}}}
      if(end<0)break;
      tr.push({t:fb.time,y:new Date(fb.time).getUTCFullYear(),r,net:r-FEE/rp,hold:end-i,rp});i=end;
    }
    const per=periods.map(([n,a,b])=>{const z=tr.filter(q=>q.y>=a&&q.y<=b);return `${f(avg(z.map(q=>q.net)))}(${z.length})`});
    let cum=0,peak=0,dd=0,streak=0,worst=0;for(const q of tr){cum+=q.net;peak=Math.max(peak,cum);dd=Math.max(dd,peak-cum);if(q.net<0){streak++;worst=Math.max(worst,streak)}else streak=0}
    const yrs=(tr.at(-1).t-tr[0].t)/(365.25*864e5);
    console.log(name.padEnd(20),`${tr.length} trades (${(tr.length/yrs).toFixed(0)}/yr)`.padEnd(20),"win",(tr.filter(q=>q.r>0).length/tr.length*100).toFixed(0)+"%","net",f(avg(tr.map(q=>q.net))),"| by period",per.join("  "),"| avg hold",(avg(tr.map(q=>q.hold))*cfg.baseSec/3600).toFixed(0)+"h","| worst losing streak",worst,"| worst drawdown",dd.toFixed(1)+"R","| avg stop",avg(tr.map(q=>q.rp)).toFixed(2)+"%");
  }
}

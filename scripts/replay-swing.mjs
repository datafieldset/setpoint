// Swing study (Nov 7): scale-out exits, trend filters, volatility squeeze on 1h and 4h Trend Rider entries. BTC_DIR = merged BTC_5m.json and BTC_1d.json.
import fs from "fs";
const T = await import("../lib/trend.js");
const c5=JSON.parse(fs.readFileSync((process.env.BTC_DIR||".")+"/BTC_5m.json")), d1=JSON.parse(fs.readFileSync((process.env.BTC_DIR||".")+"/BTC_1d.json"));
const FAR=Date.now()+1e12,FEE=0.15;
const sma200=new Map();{const q=[];let s=0;for(const x of d1){if(q.length===200)s-=q.shift();q.push(x.close);s+=x.close;if(q.length===200)sma200.set(Math.floor(x.time/864e5)+1,s/200)}}
const h1=T.splitBars(c5,3600,300,FAR).done,h4=T.splitBars(c5,14400,300,FAR).done,htf=T.makeHtf(h1,h4);
const avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN,f=v=>isNaN(v)?"  n/a":((v>=0?"+":"")+v.toFixed(2));
const eras=[["20-21",2020,2021],["22",2022,2022],["23-24",2023,2024],["25-26",2025,2026]];
const smaArr=(B,n)=>{const o=new Array(B.length).fill(null);let s=0;for(let i=0;i<B.length;i++){s+=B[i].close;if(i>=n)s-=B[i-n].close;if(i>=n-1)o[i]=s/n}return o};
// exit simulators: return {r (total R, 1R = initial risk), end}
function exitSim(B,i,E,S,r0,atr,x){
  const lim=Math.min(B.length-1,i+1500);
  if(x.k){const Tg=E+x.k*r0;for(let k=i+1;k<=lim;k++){const b=B[k];if(b.low<=S)return{r:-1,end:k};if(b.high>=Tg)return{r:x.k,end:k}}return null}
  if(x.tr){let t=S,hi=E;for(let k=i+1;k<=lim;k++){const b=B[k];if(b.low<=t)return{r:(t-E)/r0,end:k};if(b.high>hi){hi=b.high;const nt=hi-x.tr*atr;if(nt>t)t=nt}}return null}
  if(x.half){ // half off at x.half R, rest: stop to breakeven then trail x.rest ATR
    const T1=E+x.half*r0;let k=i+1;for(;k<=lim;k++){const b=B[k];if(b.low<=S)return{r:-1,end:k};if(b.high>=T1)break}
    if(k>lim)return null;
    let t=E,hi=Math.max(B[k].high,E);const banked=0.5*x.half;
    // same bar after hit: only continue from next bar (cautious)
    for(let q=k+1;q<=lim;q++){const b=B[q];if(b.low<=t)return{r:banked+0.5*((t-E)/r0),end:q};if(b.high>hi){hi=b.high;const nt=hi-x.rest*atr;if(nt>t)t=nt}}return null}
}
function runTf(tf,filter,x){
  const cfg=T.TREND_TFS[tf],B=T.splitBars(c5,cfg.baseSec,300,FAR).done,pre=T.precompute(B);
  const S7=smaArr(B,7*86400/cfg.baseSec),S20=smaArr(B,20*86400/cfg.baseSec),day=86400/cfg.baseSec;
  const tr=[];
  for(let i=300;i<B.length-2;i++){
    const fb=B[i+1];
    const a=T.analyze(cfg,B,pre,i,{time:fb.time,open:fb.open,high:fb.high,low:fb.low,close:fb.open},{sma:sma200.get(Math.floor(fb.time/864e5)),htf});
    if(!a||!a.bull.fire)continue;
    const ctx={B,i,S7,S20,day};if(filter&&!filter(ctx))continue;
    const e=a.bull,E=e.entry,S=e.stop,r0=E-S,atr=pre.atr[i];
    const res=exitSim(B,i,E,S,r0,atr,x);if(!res)break;
    const rp=r0/E*100;tr.push({t:fb.time,y:new Date(fb.time).getUTCFullYear(),r:res.r,net:res.r-FEE/rp,hold:res.end-i,rp});i=res.end;
  }
  return {tr,sec:cfg.baseSec};
}
function line(name,{tr,sec}){
  if(tr.length<15)return name.padEnd(34)+` only ${tr.length} trades`;
  const yrs=(tr.at(-1).t-tr[0].t)/(365.25*864e5);let cum=0,pk=0,dd=0,st=0,w=0;for(const q of tr){cum+=q.net;pk=Math.max(pk,cum);dd=Math.max(dd,pk-cum);if(q.net<0){st++;w=Math.max(w,st)}else st=0}
  const per=eras.map(([n,a,b])=>{const z=tr.filter(q=>q.y>=a&&q.y<=b);return z.length>=6?f(avg(z.map(q=>q.net)))+`(${z.length})`:"  -  "}).join(" ");
  return name.padEnd(34)+`${String(tr.length).padStart(4)} (${(tr.length/yrs).toFixed(0).padStart(2)}/yr) profitable ${(tr.filter(q=>q.net>0).length/tr.length*100).toFixed(0).padStart(2)}%  net ${f(avg(tr.map(q=>q.net)))}  eras ${per}  streak ${w} dd ${dd.toFixed(0)}R hold ${(avg(tr.map(q=>q.hold))*sec/3600).toFixed(0)}h`;
}
console.log("=== A. Scale out (profitable% counts a trade as a win if it makes money after fees) ===");
for(const tf of ["1h","4h"]){
  console.log("--",tf);
  for(const [n,x] of [["all-in 3R",{k:3}],["all-in trail 4 ATR",{tr:4}],["half at 1R, rest trail 4",{half:1,rest:4}],["half at 1.5R, rest trail 3",{half:1.5,rest:3}],["half at 1.5R, rest trail 4",{half:1.5,rest:4}],["half at 2R, rest trail 4",{half:2,rest:4}]])console.log(line(n,runTf(tf,null,x)));
}
console.log("\n=== B. Trend filter on entries (exit: half at 1.5R, rest trail 4) ===");
const F={"no filter":null,
 "above rising 7d line":c=>c.S7[c.i]!=null&&c.B[c.i].close>c.S7[c.i]&&c.S7[c.i]>c.S7[c.i-c.day],
 "above 20d line":c=>c.S20[c.i]!=null&&c.B[c.i].close>c.S20[c.i],
 "week is up (close > 7d ago)":c=>c.i>7*c.day&&c.B[c.i].close>c.B[c.i-7*c.day].close,
 "rising 7d line AND week up":c=>c.S7[c.i]!=null&&c.i>7*c.day&&c.B[c.i].close>c.S7[c.i]&&c.S7[c.i]>c.S7[c.i-c.day]&&c.B[c.i].close>c.B[c.i-7*c.day].close,
 "week is DOWN (opposite)":c=>c.i>7*c.day&&c.B[c.i].close<=c.B[c.i-7*c.day].close};
for(const tf of ["1h","4h"]){console.log("--",tf);for(const [n,fl] of Object.entries(F))console.log(line(n,runTf(tf,fl,{half:1.5,rest:4})))}
// C. squeeze
console.log("\n=== C. Volatility squeeze then breakout above the 20-bar high (stop 2 ATR) ===");
function squeeze(tf,x,pctl){
  const cfg=T.TREND_TFS[tf],B=T.splitBars(c5,cfg.baseSec,300,FAR).done,pre=T.precompute(B);const tr=[];
  const bw=new Array(B.length).fill(null);for(let i=20;i<B.length;i++){let s=0,s2=0;for(let j=i-19;j<=i;j++){s+=B[j].close;s2+=B[j].close**2}const m=s/20,sd=Math.sqrt(Math.max(0,s2/20-m*m));bw[i]=4*sd/m}
  for(let i=200;i<B.length-2;i++){
    if(bw[i]==null||pre.atr[i]==null)continue;
    const win=[];for(let j=i-120;j<i;j++)if(bw[j]!=null)win.push(bw[j]);win.sort((a,b)=>a-b);const thr=win[Math.floor(win.length*pctl)];
    let sq=false;for(let j=i-3;j<=i-1;j++)if(bw[j]<=thr)sq=true; // squeezed within the last 3 bars
    if(!sq)continue;let hi=-1;for(let j=i-20;j<i;j++)hi=Math.max(hi,B[j].high);
    if(!(B[i].close>hi))continue;
    const E=B[i].close,atr=pre.atr[i],S=E-2*atr,r0=E-S;const res=exitSim(B,i,E,S,r0,atr,x);if(!res)break;
    const rp=r0/E*100;tr.push({t:B[i].time,y:new Date(B[i].time).getUTCFullYear(),r:res.r,net:res.r-FEE/rp,hold:res.end-i,rp});i=res.end}
  return {tr,sec:cfg.baseSec};
}
for(const tf of ["1h","4h"]){console.log("--",tf);for(const [n,x] of [["3R",{k:3}],["half at 1.5R, rest trail 4",{half:1.5,rest:4}]])for(const p of [0.2])console.log(line(`squeeze (lowest ${p*100}%) ${n}`,squeeze(tf,x,p)))}

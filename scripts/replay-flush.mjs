// Flush study (Nov 8): 1h bar drops 2.5%+ open to low and breaks the 48h low; four ways to trade it. BTC_DIR = merged BTC_5m.json.
import fs from "fs";
const T = await import("../lib/trend.js");
const c5=JSON.parse(fs.readFileSync((process.env.BTC_DIR||".")+"/BTC_5m.json"));const B=T.splitBars(c5,3600,300,Date.now()+1e12).done,pre=T.precompute(B);
const FEE=0.15,avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN,f=v=>isNaN(v)?"  n/a":((v>=0?"+":"")+v.toFixed(2));
const eras=[["20-21",2020,2021],["22",2022,2022],["23-24",2023,2024],["25-26",2025,2026]];
const ev=[];for(let i=60;i<B.length-300;i++){const b=B[i];if((b.open-b.low)/b.open<0.025)continue;let lo=1e18;for(let j=i-48;j<i;j++)lo=Math.min(lo,B[j].low);if(b.low>=lo)continue;ev.push(i);i+=12}
function sim(i0,E,S,dir,x,tgtFn){ // dir 1 long, -1 short; returns {r,end}
  const r0=Math.abs(E-S);let st=S,best=E;const lim=Math.min(B.length-1,i0+600);const atr=pre.atr[i0];
  const tgt=x.k?E+dir*x.k*r0:(x.half?E+dir*tgtFn*1:null);
  for(let k=i0+1;k<=lim;k++){const b=B[k];
    if(dir>0?b.low<=st:b.high>=st)return{r:x.tr?dir*(st-E)/r0:-1,end:k};
    if(tgt!==null&&(dir>0?b.high>=tgt:b.low<=tgt))return{r:Math.abs(tgt-E)/r0,end:k};
    if(x.tr){const fav=dir>0?b.high:b.low;if(dir*(fav-best)>0){best=fav;const ns=best-dir*x.tr*atr;if(dir*(ns-st)>0)st=ns}}}
  return null}
const rows={};
function add(name,rec){(rows[name]??=[]).push(rec)}
const exits=[["2R",{k:2}],["3R",{k:3}],["trail 3 ATR",{tr:3}]];
for(const i of ev){const b=B[i],atr=pre.atr[i];if(atr==null)continue;const y=new Date(b.time).getUTCFullYear();
  for(const [en,x] of exits){
    // E1 buy at close of flush bar
    {const E=b.close,S=b.low-0.5*atr;if(E>S){const r=sim(i,E,S,1,x);if(r)add(`E1 buy right after the flush, ${en}`,{y,r:r.r,rp:(E-S)/E*100})}}
    // E2 limit buy near the flush low, wait up to 24 bars
    {const L=b.low+0.25*atr,S=b.low-0.75*atr;let fill=-1;for(let k=i+1;k<=i+24;k++){if(B[k].low<=S)break;if(B[k].low<=L){fill=k;break}}
      if(fill>0){const r=sim(fill,L,S,1,x);if(r)add(`E2 limit buy at the flush low (retest), ${en}`,{y,r:r.r,rp:(L-S)/L*100})}}
    // E3 buy after first higher close that clears the prior bar high
    {let c=-1;for(let k=i+1;k<=i+12;k++){if(B[k].close>B[k-1].high&&B[k].close>b.low){c=k;break}if(B[k].low<b.low-0.5*atr)break}
      if(c>0){let lo=1e18;for(let k=i;k<=c;k++)lo=Math.min(lo,B[k].low);const E=B[c].close,S=lo-0.25*atr;if(E>S){const r=sim(c,E,S,1,x);if(r)add(`E3 buy after a higher close (confirmation), ${en}`,{y,r:r.r,rp:(E-S)/E*100})}}}
    // E4 short when a 1h bar closes below the flush low
    {let c=-1;for(let k=i+1;k<=i+24;k++){if(B[k].close<b.low){c=k;break}}
      if(c>0){const E=B[c].close,S=Math.max(...B.slice(i,c+1).map(z=>z.high).slice(-3))+0.25*atr;if(S>E){const r=sim(c,E,S,-1,x);if(r)add(`E4 sell when it closes below the flush low, ${en}`,{y,r:r.r,rp:(S-E)/E*100})}}}
  }}
console.log("flush events:",ev.length,"(about",(ev.length/6.8).toFixed(0),"a year), fee",FEE+"%","| variants:",Object.keys(rows).length);
for(const [name,a] of Object.entries(rows)){if(a.length<15)continue;const net=a.map(t=>t.r-FEE/t.rp);
  const byEra=eras.map(([n,s,e])=>{const z=a.filter(t=>t.y>=s&&t.y<=e);return z.length?avg(z.map(t=>t.rp)).toFixed(2)+"%":"-"}).join(" ");if(name.includes("E2")&&name.includes("3R"))console.log("   avg stop by era (20-21, 22, 23-24, 25-26):",byEra);console.log(name.padEnd(52),String(a.length).padStart(3),"trades",(a.filter((t,j)=>net[j]>0).length/a.length*100).toFixed(0).padStart(2)+"% profitable","avg stop",avg(a.map(t=>t.rp)).toFixed(1)+"%","net",f(avg(net)),"| eras",eras.map(([n,s,e])=>{const idx=a.map((t,j)=>j).filter(j=>a[j].y>=s&&a[j].y<=e);return idx.length>=5?f(avg(idx.map(j=>net[j])))+`(${idx.length})`:" - "}).join(" "))}

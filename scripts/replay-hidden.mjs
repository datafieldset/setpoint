// Hidden-signal study (Nov 7). Run from a folder holding the merged BTC_5m.json plus bg_<tf>.json made by the bg replay (see memory/lessons-learned.md Nov 7). Prints as-built results after fees, other exits, and confluence.
import fs from "fs";
const T = await import("../lib/trend.js");
const c5=JSON.parse(fs.readFileSync("BTC_5m.json"));const FAR=Date.now()+1e12;
const SEC={ "5m":300,"15m":900,"30m":1800,"1h":3600,"4h":14400};
const FEE=0.15, avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN, f=v=>isNaN(v)?"  n/a ":((v>=0?"+":"")+v.toFixed(2));
const eras=[["20-21",2020,2021],["22",2022,2022],["23-24",2023,2024],["25-26",2025,2026]];
const yr=t=>new Date(t).getUTCFullYear();
const ev=[];const bars={};
for(const tf of Object.keys(SEC)){
  bars[tf]=SEC[tf]===300?c5:T.splitBars(c5,SEC[tf],300,FAR).done;
  const idx=new Map(bars[tf].map((b,i)=>[b.time,i]));
  const rows=JSON.parse(fs.readFileSync(`bg_${tf}.json`));
  for(const e of rows){
    // event t is the signal bar's open time; entry is that bar's close, so outcomes start next bar
    const i=idx.get(e.t);if(i==null)continue;
    const risk=Math.abs(e.entry-e.stop);e.i=i;e.risk=risk;e.rp=risk/e.entry*100;e.key=`${e.label}|${tf}|${e.dir}`;e.y=yr(e.t);ev.push(e);
  }
}
const net=(r,rp)=>r-FEE/rp;
function eraStr(list,get){return eras.map(([n,a,b])=>{const z=list.filter(e=>e.y>=a&&e.y<=b);return z.length>=8?f(avg(z.map(get)))+`(${z.length})`:"  -  "}).join(" ")}
// --- A: as built (2R target)
const by={};for(const e of ev)(by[e.key]??=[]).push(e);
const A=Object.entries(by).filter(([k,a])=>a.length>=100).map(([k,a])=>({k,a,n:a.length,win:a.filter(e=>e.r>0).length/a.length*100,gross:avg(a.map(e=>e.r)),net:avg(a.map(e=>net(e.r,e.rp)))})).sort((p,q)=>q.net-p.net);
console.log(`### A. As built (2R target), fee ${FEE}%: ${ev.length} trades, ${A.length} combos with 100+ trades`);
console.log("combo".padEnd(30),"trades win%  gross   NET   | NET by era "+eras.map(e=>e[0]).join("  "));
for(const x of A.slice(0,10))console.log(x.k.padEnd(30),String(x.n).padStart(5),x.win.toFixed(0).padStart(3)+"%",f(x.gross),f(x.net),"|",eraStr(x.a,e=>net(e.r,e.rp)));
console.log("combos positive after fees:",A.filter(x=>x.net>0).length,"of",A.length);
// --- B: exits
function sim(e,mode,val){ // returns R
  const B=bars[e.key.split("|")[1]];const dir=e.dir==="bull"?1:-1;let stop=e.stop,best=e.entry;
  const tgt=mode==="k"?e.entry+dir*val*e.risk:null;
  for(let j=e.i+1;j<B.length&&j<=e.i+600;j++){const b=B[j];
    const hitS=dir>0?b.low<=stop:b.high>=stop;if(hitS)return mode==="k"?-1:(dir*(stop-e.entry))/e.risk;
    if(mode==="k"){const hitT=dir>0?b.high>=tgt:b.low<=tgt;if(hitT)return val}
    else{const fav=dir>0?b.high:b.low;if(dir*(fav-best)>0){best=fav;const ns=best-dir*val*e.risk;if(dir*(ns-stop)>0)stop=ns}}
  }
  return null;
}
const exits=[["as built",null],["3R",["k",3]],["4R",["k",4]],["trail 2x",["t",2]],["trail 3x",["t",3]]];
const cand=A.filter(x=>x.n>=100);
console.log(`\n### B. Other exits for the same entries (ungated, so overlapping trades count)`);
const goodB=[];
for(const x of cand){
  const row={};for(const [nm,m] of exits){const rs=x.a.map(e=>{const r=m?sim(e,m[0],m[1]):e.r;return r===null?null:{r,n:net(r,e.rp),y:e.y}}).filter(Boolean);row[nm]=rs}
  for(const [nm] of exits){const rs=row[nm];const ok=eras.every(([n,a,b])=>{const z=rs.filter(q=>q.y>=a&&q.y<=b);return z.length<8||avg(z.map(q=>q.n))>0});
    if(avg(rs.map(q=>q.n))>0&&ok)goodB.push({k:x.k,nm,n:rs.length,win:rs.filter(q=>q.r>0).length/rs.length*100,net:avg(rs.map(q=>q.n)),era:eras.map(([n,a,b])=>{const z=rs.filter(q=>q.y>=a&&q.y<=b);return z.length>=8?f(avg(z.map(q=>q.n))):" - "}).join(" ")})}
}
goodB.sort((p,q)=>q.net-p.net);
console.log(`combo x exit pairs tried: ${cand.length*exits.length}; positive after fees in every era with data: ${goodB.length}`);
for(const g of goodB.slice(0,14))console.log(g.k.padEnd(30),g.nm.padEnd(9),String(g.n).padStart(5),g.win.toFixed(0).padStart(3)+"%","net",f(g.net),"| eras",g.era);
// --- C: confluence
console.log(`\n### C. Confluence: other hidden signals firing the same direction on the same chart within the last 2 bars (as built, 2R)`);
for(const tf of ["5m","15m","30m","1h"]){
  const list=ev.filter(e=>e.key.split("|")[1]===tf);const base=SEC[tf]*1000;
  const idx={};for(const e of list){((idx[e.dir]??={})[e.label]??=[]).push(e.t)}
  for(const e of list){let c=0;for(const lab of Object.keys(idx[e.dir])){if(lab===e.label)continue;if(idx[e.dir][lab].some(t=>t<=e.t&&t>=e.t-2*base))c++}e.c=c}
  const out=[0,1,2].map(m=>{const z=list.filter(e=>m===2?e.c>=2:e.c===m);return `${m===2?"2+":m} others: ${z.length} trades ${z.length?(z.filter(e=>e.r>0).length/z.length*100).toFixed(0):"-"}% net ${f(avg(z.map(e=>net(e.r,e.rp))))}`});
  console.log(tf.padEnd(4),out.join(" | "));
  const z2=list.filter(e=>e.c>=2);console.log("     2+ others by era:",eraStr(z2,e=>net(e.r,e.rp)));
}

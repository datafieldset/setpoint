// Moving-average bounce / cross study (Nov 7). BTC_DIR = folder with the merged BTC_5m.json.
import fs from "fs";
const T = await import("../lib/trend.js");
const c5=JSON.parse(fs.readFileSync((process.env.BTC_DIR||".")+"/BTC_5m.json"));const FAR=Date.now()+1e12;
const FEE=0.15,avg=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:NaN,f=v=>isNaN(v)?"  n/a":((v>=0?"+":"")+v.toFixed(2));
const eras=[["20-21",2020,2021],["22",2022,2022],["23-24",2023,2024],["25-26",2025,2026]];
const yr=t=>new Date(t).getUTCFullYear();
const TF={"1h":3600,"4h":14400};
function atr14(B){const a=new Array(B.length).fill(null);let s=0;for(let i=1;i<B.length;i++){const tr=Math.max(B[i].high-B[i].low,Math.abs(B[i].high-B[i-1].close),Math.abs(B[i].low-B[i-1].close));if(i<=14){s+=tr;if(i===14)a[i]=s/14}else a[i]=(a[i-1]*13+tr)/14}return a}
function sma(B,n){const o=new Array(B.length).fill(null);let s=0;for(let i=0;i<B.length;i++){s+=B[i].close;if(i>=n)s-=B[i-n].close;if(i>=n-1)o[i]=s/n}return o}
const exits=[["2R",["k",2]],["3R",["k",3]],["trail 3 ATR",["t",3]]];
function run(B,A,setup,dir,exit){
  const trades=[];
  for(let i=0;i<B.length-1;i++){
    const s=setup(i);if(!s)continue;
    const b=B[i],E=b.close,atr=A[i];if(atr==null)continue;
    const stop=dir>0?b.low-0.5*atr:b.high+0.5*atr;const risk=Math.abs(E-stop);if(risk<=0)continue;
    let r=null,end=-1,st=stop,best=E;const tgt=exit[0]==="k"?E+dir*exit[1]*risk:null;
    for(let j=i+1;j<B.length&&j<=i+800;j++){const c=B[j];
      if(dir>0?c.low<=st:c.high>=st){r=exit[0]==="k"?-1:dir*(st-E)/risk;end=j;break}
      if(tgt!==null&&(dir>0?c.high>=tgt:c.low<=tgt)){r=exit[1];end=j;break}
      if(exit[0]==="t"){const fav=dir>0?c.high:c.low;if(dir*(fav-best)>0){best=fav;const ns=best-dir*exit[1]*atr;if(dir*(ns-st)>0)st=ns}}}
    if(end<0)break;
    const rp=risk/E*100;trades.push({y:yr(b.time),r,net:r-FEE/rp,rp,hold:end-i});i=end;
  }
  return trades;
}
const out=[];
for(const [tf,sec] of Object.entries(TF)){
  const B=T.splitBars(c5,sec,300,FAR).done,A=atr14(B);const perDay=86400/sec;
  for(const days of [7,9,20]){
    const n=Math.round(days*perDay),M=sma(B,n);const k=Math.round(perDay/2*1.0)+4; // bars of "was above" before touch
    for(const dir of [1,-1]){
      const mk={
        bounce:(i)=>{if(i<n+k+perDay||M[i]==null)return false;const b=B[i];
          const slope=dir*(M[i]-M[i-Math.round(perDay)])>0; if(!slope)return false;
          for(let q=1;q<=k;q++){if(dir*(B[i-q].close-M[i-q])<=0)return false}
          return dir>0?(b.low<=M[i]&&b.close>M[i]&&b.close>b.open):(b.high>=M[i]&&b.close<M[i]&&b.close<b.open)},
        cross:(i)=>{if(i<n+2||M[i]==null)return false;const b=B[i],p=B[i-1];return dir>0?(p.close<=M[i-1]&&b.close>M[i]):(p.close>=M[i-1]&&b.close<M[i])}};
      for(const [sn,fn] of Object.entries(mk))for(const [en,ex] of exits){
        const tr=run(B,A,fn,dir,ex);if(tr.length<40)continue;
        out.push({tf,days,dir:dir>0?"buy":"sell",setup:sn,exit:en,n:tr.length,win:tr.filter(t=>t.r>0).length/tr.length*100,gross:avg(tr.map(t=>t.r)),net:avg(tr.map(t=>t.net)),stop:avg(tr.map(t=>t.rp)),hold:avg(tr.map(t=>t.hold))*sec/3600,
          era:eras.map(([nm,a,b])=>{const z=tr.filter(t=>t.y>=a&&t.y<=b);return z.length>=8?f(avg(z.map(t=>t.net)))+`(${z.length})`:"  -  "}).join(" "),
          allpos:eras.every(([nm,a,b])=>{const z=tr.filter(t=>t.y>=a&&t.y<=b);return z.length<8||avg(z.map(t=>t.net))>0})});
      }
    }
  }
}
out.sort((p,q)=>q.net-p.net);
console.log("setups tried:",out.length," | positive after fees overall:",out.filter(o=>o.net>0).length," | positive in every era:",out.filter(o=>o.net>0&&o.allpos).length);
console.log("tf  MA  dir  setup  exit        trades win% stop%  hold  gross   NET  | NET by era "+eras.map(e=>e[0]).join("  "));
for(const o of out.slice(0,16))console.log(o.tf.padEnd(3),(o.days+"d").padEnd(3),o.dir.padEnd(4),o.setup.padEnd(6),o.exit.padEnd(11),String(o.n).padStart(5),o.win.toFixed(0).padStart(3)+"%",o.stop.toFixed(1).padStart(4),(o.hold.toFixed(0)+"h").padStart(5),f(o.gross),f(o.net),"|",o.era,o.allpos&&o.net>0?" <-- all eras +":"");
console.log("\nplain bounce BUYS on the 7 day line, by exit:");
for(const o of out.filter(o=>o.days===7&&o.dir==="buy"&&o.setup==="bounce"))console.log("  ",o.tf,o.exit.padEnd(11),o.n,"trades",o.win.toFixed(0)+"%","net",f(o.net),"|",o.era);

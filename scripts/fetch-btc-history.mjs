import fs from "fs";
const B="https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT";
async function get(interval, startMs, endMs){
  let out=[], t=startMs;
  while(t<endMs){
    const r=await fetch(`${B}&interval=${interval}&startTime=${t}&limit=1000`);
    const k=await r.json(); if(!Array.isArray(k)||!k.length) break;
    for(const x of k) out.push({time:x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volumeto:+x[5]});
    t=k[k.length-1][0]+1; if(k.length<1000) break;
  }
  return out;
}
const now=Date.now();
const d5=await get("5m", now-730*864e5, now);
fs.writeFileSync("BTC_5m.json", JSON.stringify(d5));
const d1=await get("1d", now-1100*864e5, now);
fs.writeFileSync("BTC_1d.json", JSON.stringify(d1));
console.log("5m",d5.length,new Date(d5[0].time).toISOString(),"1d",d1.length);

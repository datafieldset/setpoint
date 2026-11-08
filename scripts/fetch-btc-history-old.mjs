// Fetches BTC 5m (Jan 2020 to Nov 6 2024) and daily (2019 on) into the current folder, for out-of-sample tests. Use: BTC_DIR=<that folder> node scripts/replay-pullback.mjs
import fs from "fs";
const B="https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT";
async function get(interval, startMs, endMs){
  let out=[], t=startMs;
  while(t<endMs){
    let k;for(let a=0;a<4;a++){try{const r=await fetch(`${B}&interval=${interval}&startTime=${t}&endTime=${endMs}&limit=1000`);k=await r.json();if(Array.isArray(k))break}catch(e){}await new Promise(r=>setTimeout(r,500))}
    if(!Array.isArray(k)||!k.length) break;
    for(const x of k) out.push({time:x[0],open:+x[1],high:+x[2],low:+x[3],close:+x[4],volumeto:+x[5]});
    t=k[k.length-1][0]+1; if(k.length<1000) break;
  }
  return out;
}
const start=Date.parse("2020-01-01"), end=Date.parse("2024-11-06T20:45:00Z");
const d5=await get("5m",start,end); fs.writeFileSync("BTC_5m.json",JSON.stringify(d5));
const d1=await get("1d",Date.parse("2019-01-01"),end); fs.writeFileSync("BTC_1d.json",JSON.stringify(d1));
console.log("5m",d5.length,new Date(d5[0].time).toISOString(),new Date(d5.at(-1).time).toISOString(),"1d",d1.length);

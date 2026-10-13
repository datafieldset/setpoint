import fs from "fs";
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function range(gran,years){
  const end=Date.now(),start=end-years*365*86400000,step=gran*300*1000,out=new Map();
  for(let t=start;t<end;t+=step){
    const url=`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=${gran}&start=${new Date(t).toISOString()}&end=${new Date(Math.min(t+step,end)).toISOString()}`;
    let raw;for(let a=0;a<5;a++){const r=await fetch(url,{headers:{"User-Agent":"setpoint-study/1.0"}});if(r.ok){raw=await r.json();break;}await sleep(1500*(a+1));}
    if(!Array.isArray(raw)){console.error("fail at",new Date(t).toISOString());continue;}
    for(const x of raw)out.set(x[0],x);
    await sleep(220);
  }
  return [...out.values()].sort((a,b)=>a[0]-b[0]);
}
// usage: node fetch-candles.mjs 3600 6 BTC_1h.json   (granularity seconds, years, output file)
const [g, y, f] = process.argv.slice(2);
const d = await range(+g, +y); fs.writeFileSync(f, JSON.stringify(d)); console.log(f, d.length);

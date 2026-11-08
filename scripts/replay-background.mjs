// scripts/replay-background.mjs (v22.2): replays every original signal on 2 years of BTC history with real win/loss results.
// Usage: node scripts/fetch-btc-history.mjs   (writes BTC_5m.json, BTC_1d.json in the current folder)  then  node scripts/replay-background.mjs 15m
// Writes bg_<tf>.json. Targets are each signal's own (all 2R today), entry at the signal bar close, one open trade per signal+direction, no fees.
import fs from "fs";
const S=await import("../lib/signals.js");
const T=await import("../lib/trend.js");
const tf=process.argv[2]; const lim=Number(process.argv[3]||0);
const sec={ "5m":300,"15m":900,"30m":1800,"1h":3600,"4h":14400}[tf];
const c5=JSON.parse(fs.readFileSync("BTC_5m.json"));
const bars=(sec===300?c5:T.splitBars(c5,sec,300,Date.now()+1e12).done).map(b=>({time:b.time,open:b.open,high:b.high,low:b.low,close:b.close,volumeto:b.volumeto}));
const th=S.thresholdsFor(tf), W=300, FOLLOW=200, out=[]; const open=new Map();
const t0=Date.now();
const start=Math.max(W,lim?bars.length-lim:W);
for(let i=start;i<bars.length-1;i++){
  const slice=bars.slice(i-W+1,i+1);
  let sig;try{const bias=S.marketBias([{sym:"BTC",pct:S.windowPct(slice,8),isBTC:true}]);({signals:sig}=S.computeSignals(slice,tf,th,{now:bars[i].time+sec*1000,marketBias:bias,reversalRisk:S.reversalRisk(bias,null)}))}catch(e){continue}
  for(const s of sig){ if(s.type==="pace"||!s.target||!s.stop||!s.dir)continue;
    const k=s.label+"|"+s.dir; const o=open.get(k); if(o&&i<o.endIdx)continue;
    const entry=bars[i].close; // signals fire on the completed bar; entry at that close
    let res=null,endIdx=Math.min(bars.length-1,i+FOLLOW);
    for(let j=i+1;j<=endIdx;j++){const c=bars[j];const ht=s.dir==="bull"?c.high>=s.target:c.low<=s.target,hs=s.dir==="bull"?c.low<=s.stop:c.high>=s.stop;if(ht&&hs){res="loss";endIdx=j;break}if(ht){res="win";endIdx=j;break}if(hs){res="loss";endIdx=j;break}}
    open.set(k,{endIdx});
    if(!res)continue;
    const risk=Math.abs(s.entry!=null?s.entry-s.stop:entry-s.stop)||Math.abs(entry-s.stop);
    const reward=Math.abs(s.target-entry);
    out.push({tf,label:s.label,dir:s.dir,t:bars[i].time,entry,stop:s.stop,target:s.target,r:res==="win"?Number((reward/Math.abs(entry-s.stop)).toFixed(3)):-1,res});
  }
  if(i%20000===0)console.error(tf,i,"/",bars.length,((Date.now()-t0)/1000).toFixed(0)+"s");
}
fs.writeFileSync(`bg_${tf}.json`,JSON.stringify(out));console.log(tf,"done",out.length,"trades",((Date.now()-t0)/1000).toFixed(0)+"s");

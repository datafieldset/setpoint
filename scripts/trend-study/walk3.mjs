import fs from "fs";
const R="/home/claude/gh-current/repo/lib/";
const { computeSignals, thresholdsFor, windowPct, marketBias, reversalRisk } = await import(R+"signals.js");
const { aggregate } = await import(R+"resolve.js");
const { barMs, TF } = await import(R+"timeframes.js");
const D="../trend", TFK=process.argv[2];
const SRC={ "15m":["15m",1],"1h":["1h",1],"4h":["1h",4] };
const [file,factor]=SRC[TFK];
const gran={"15m":900,"1h":3600}[file];
let c=JSON.parse(fs.readFileSync(`${D}/BTC_${file}.json`)).map(r=>({time:r[0]*1000,low:r[1],high:r[2],open:r[3],close:r[4],volumeto:r[5]})).filter(x=>x.close>0).sort((a,b)=>a.time-b.time);
if(factor>1) c=aggregate(c,gran,factor);
const bar=barMs(TFK), WIN=300; const rows=[];
for(let i=WIN;i<c.length-1;i++){
  const slice=c.slice(i-WIN+1,i+1);
  const bias=marketBias([{sym:"BTC",pct:windowPct(slice,8),isBTC:true}]);
  const risk=reversalRisk(bias,null);
  let out; try{ out=computeSignals(slice,TFK,thresholdsFor(TFK),{now:c[i].time+bar,marketBias:bias,reversalRisk:risk}); }catch(e){continue;}
  for(const s of out.signals){
    if(s.type==="pace"||!s.target||!s.stop) continue;
    rows.push({i,t:c[i].time,label:s.label,dir:s.dir,entry:s.entry,stop:s.stop,target:s.target});
  }
}
fs.writeFileSync(`fires_${TFK}.json`,JSON.stringify({bars:c.length,rows}));
console.log(TFK,"bars",c.length,"fires",rows.length);

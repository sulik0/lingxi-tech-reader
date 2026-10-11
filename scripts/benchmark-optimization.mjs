// Real article bodies/results stay in ignored work/. No collection, database mutation or delivery on production.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {AutomationStore} from '../lib/automation/store.ts';
import {filterArticles} from '../lib/automation/screening.ts';
import {defaultPolicy} from '../lib/automation/policy.ts';
import {processEvents,renderEvents} from '../lib/automation/events.ts';
import {hash} from '../lib/automation/feeds.ts';
const path=process.argv[2];if(!path)throw Error('Usage: node scripts/benchmark-optimization.mjs work/optimization/corpus.json');
const samples=JSON.parse(readFileSync(path,'utf8')),vars=Object.fromEntries(readFileSync('.dev.vars','utf8').split('\n').map(l=>l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^['"]|['"]$/g,'')]));
const now=Date.now();mkdirSync('work/optimization',{recursive:true});
function database(){const sql=new DatabaseSync(':memory:');for(const e of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync('drizzle/'+e.tag+'.sql','utf8'));
 const wrap=(q,p=[])=>({bind(...x){return wrap(q,x)},async all(){return {results:sql.prepare(q).all(...p)}},async first(){return sql.prepare(q).get(...p)||null},async run(){return {meta:{changes:Number(sql.prepare(q).run(...p).changes)}}}});
 return {prepare:wrap,async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}},close:()=>sql.close()};}
const rows=[];
for(const mode of ['baseline','optimized']){
 const DB=database(),store=new AutomationStore(DB),environment={...vars,DB,...(mode==='baseline'?{JEV_API_KEY:undefined}: {})};
 const calls=[];let phase='initial';
 const fetcher=async(url,init)=>{if(!['https://api.deepseek.com/chat/completions','https://api.typesafe.ai/v1/systemone'].includes(String(url)))throw Error('Benchmark refuses non-model traffic');
  const request=JSON.parse(init.body),isJev=String(url).includes('typesafe');
  const bridge=`import sys,json,ssl,urllib.request,urllib.error,os
x=json.load(sys.stdin)
try:
 req=urllib.request.Request(x['url'],data=x.get('body','').encode(),headers=x.get('headers',{}),method=x.get('method','POST'))
 with urllib.request.urlopen(req,timeout=65,context=ssl.create_default_context(cafile='/etc/ssl/cert.pem' if os.path.exists('/etc/ssl/cert.pem') else None)) as r:print(json.dumps({'status':r.status,'body':r.read().decode()}))
except urllib.error.HTTPError as e:print(json.dumps({'status':e.code,'body':e.read().decode()}))`;
  const r=spawnSync(process.env.LINGXI_BENCH_PYTHON||'python3',['-c',bridge],{input:JSON.stringify({url:String(url),body:init.body,method:init.method,headers:init.headers}),encoding:'utf8',maxBuffer:4e6});if(r.status!==0)throw Error('Model transport unavailable');
  const response=JSON.parse(r.stdout),raw=JSON.parse(response.body);const stage=isJev?(Object.values(request.questions)[0]?.type||'unknown'):Array.isArray(JSON.parse(request.messages[1].content))?'group':request.messages.length>2?'repair':'analysis';
  const usage=raw.usage;calls.push({phase,provider:isJev?'Jev':'DeepSeek',stage,model:raw.model||request.model,input:usage?.prompt_tokens??usage?.input_tokens??null,output:usage?.completion_tokens??usage?.output_tokens??null,cacheHit:usage?.prompt_cache_hit_tokens??null,cacheMiss:usage?.prompt_cache_miss_tokens??null,status:response.status});
  writeFileSync(`work/optimization/${mode}-calls.json`,JSON.stringify(calls,null,2));return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});
 };
 const batches=samples.batches;
 for(const batch of batches){phase=batch.phase;
  for(const [index,raw] of batch.articles.entries()){
   const id=raw.id||await hash(mode+phase+index),sid='s:'+phase+index;
   await store.addSource({id:sid,name:raw.source,url:'https://example.test/feed/'+encodeURIComponent(sid),enabled:true});
   await store.addArticles(sid,[{...raw,id,publishedAt:now-1000,collectedAt:now,contentHash:await hash(raw.content.replace(/\s+/g,''))}]);
  }
  const before=calls.length;
  if(mode==='baseline'){const pending=await store.unprocessed(60);const screened=await filterArticles(store,pending,defaultPolicy,{...vars,DB},now,fetcher);if(screened.articles.length!==pending.length)throw Error('Baseline screening rejected an article; compare only identical accepted input.');}
  const errors=await processEvents(store,environment,now+1000,fetcher),events=await store.events();
  const complete=events.filter(e=>!e.pending);writeFileSync(`work/optimization/${mode}-${phase}-events.json`,JSON.stringify(events,null,2));writeFileSync(`work/optimization/${mode}-${phase}-report.md`,renderEvents('验收报告（不发送）',complete,[]));
  const current=calls.slice(before);const tokens=provider=>({input:current.filter(c=>c.provider===provider).reduce((n,c)=>n+(c.input||0),0),output:current.filter(c=>c.provider===provider).reduce((n,c)=>n+(c.output||0),0),unknown:current.filter(c=>c.provider===provider&&(c.input===null||c.output===null)).length,calls:current.filter(c=>c.provider===provider).length});
  const row={mode,phase,articles:batch.articles.length,completedEvents:complete.length,pendingEvents:events.length-complete.length,failures:errors||[],DeepSeek:tokens('DeepSeek'),Jev:tokens('Jev')};rows.push(row);console.log(JSON.stringify(row));writeFileSync('work/optimization/results.json',JSON.stringify(rows,null,2));
 }
 DB.close();
}

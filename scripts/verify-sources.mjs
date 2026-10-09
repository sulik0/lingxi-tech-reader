// Live article bodies stay in the ignored work/ directory, never in Git.
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {AutomationStore} from '../lib/automation/store.ts';
import {fetchFeed} from '../lib/automation/feeds.ts';
import {processEvents,renderEvents} from '../lib/automation/events.ts';
mkdirSync('work/acceptance',{recursive:true});
const sql=new DatabaseSync('work/acceptance/live.sqlite');
sql.exec('CREATE TABLE IF NOT EXISTS applied_migrations(name TEXT PRIMARY KEY)');
for(const file of ['0001_automation.sql','0002_events.sql'])if(!sql.prepare('SELECT name FROM applied_migrations WHERE name=?').get(file)){sql.exec(readFileSync('migrations/'+file,'utf8'));sql.prepare('INSERT INTO applied_migrations VALUES(?)').run(file);}
const wrap=(text,args=[])=>({bind(...values){return wrap(text,values)},async first(){return sql.prepare(text).get(...args)||null},async all(){return {results:sql.prepare(text).all(...args)}},async run(){return {meta:{changes:Number(sql.prepare(text).run(...args).changes)}}}});
const DB={prepare:wrap,async batch(items){sql.exec('BEGIN');try{const results=[];for(const s of items)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}};
const store=new AutomationStore(DB),now=Date.now();
const feeds=[['geekpark','极客公园','https://www.geekpark.net/rss'],['baoyu','宝玉博客','https://s.baoyu.io/feed.xml'],['ithome','IT之家','https://www.ithome.com/rss/']];
const fetcher=process.argv.includes('--curl')?async(url,init)=>{
  if(!feeds.some(f=>f[2]===String(url)))return fetch(url,init);
  const body=execFileSync('curl',['--fail','--silent','--show-error','--max-time','30',String(url)],{maxBuffer:2000000});return new Response(body);
}:fetch;
const results=[];
for(const [id,name,url] of feeds){try{if(!(await store.sources()).some(s=>s.id===id))await store.addSource({id,name,url,enabled:true});const articles=await fetchFeed({id,name,url,enabled:true},'www.geekpark.net,s.baoyu.io,www.ithome.com',now,fetcher);const added=await store.addArticles(id,articles),repeated=await store.addArticles(id,articles);results.push({name,url,parsed:articles.length,added,repeated,short:articles.filter(a=>a.content.length<80).length});await store.sourceResult(id,now,'');}catch(e){results.push({name,url,error:e.message});await store.sourceResult(id,now,e.message);}}
const env={DB,...Object.fromEntries(['LLM_API_KEY','LLM_BASE_URL','LLM_MODEL'].map(k=>[k,process.env[k]]))};
let analysisError='';try{analysisError=(await processEvents(store,env,now,fetcher))?.join('；')||'';}catch(e){analysisError=e.message;}
const events=await store.events();
writeFileSync('work/acceptance/events.json',JSON.stringify(events,null,2));
writeFileSync('work/acceptance/brief.md',renderEvents(new Date(now+8*3600000).toISOString().slice(0,10),events,[]));
const report={checkedAt:new Date(now).toISOString(),transport:process.argv.includes('--curl')?'curl (not Worker)':'Node fetch (not Worker)',sources:results,events:events.length,analyzed:events.filter(e=>!e.pending).length,analysisError,modelConfigured:!!env.LLM_API_KEY};
writeFileSync('work/acceptance/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));sql.close();

import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {AutomationStore} from '../lib/automation/store.ts';
import {processEvents,renderEvents} from '../lib/automation/events.ts';
import {selectEvidence} from '../lib/automation/evidence.ts';
import {validateDecisions} from '../lib/automation/jev-decisions.ts';
import {analyzeArticles,validateInput} from '../lib/analyze.ts';
import {invalidateEvent} from '../lib/event-state.ts';
import {hash} from '../lib/automation/feeds.ts';
import {runAutomation} from '../lib/automation/runner.ts';
const now=Date.now(),source={id:'s',name:'自编验收来源',url:'https://example.test/feed',enabled:true};
function db(){const sql=new DatabaseSync(':memory:');for(const e of JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries)sql.exec(readFileSync('drizzle/'+e.tag+'.sql','utf8'));const wrap=(q,p=[])=>({bind(...x){return wrap(q,x)},async all(){return {results:sql.prepare(q).all(...p)}},async first(){return sql.prepare(q).get(...p)||null},async run(){return {meta:{changes:Number(sql.prepare(q).run(...p).changes)}}}});return {prepare:wrap,async batch(stmts){sql.exec('BEGIN');try{const r=[];for(const s of stmts)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}},close:()=>sql.close()};}
const environment=DB=>({DB,JEV_API_KEY:'test-only',JEV_MODEL:'jev-test',LLM_API_KEY:'test-only',LLM_BASE_URL:'https://model.test',LLM_MODEL:'model-test'});
async function article(id,extra=''){const content='这是铺垫，没有技术信息。'.repeat(20)+'\n示例模型新增本地部署功能。\n'+extra;return {id,title:'示例模型发布',source:source.name,author:'自编作者',content,url:'https://example.test/'+id,publishedAt:now,collectedAt:now,contentHash:await hash(content)};}
function provider(calls,options={}){return async(url,init)=>{const input=JSON.parse(init.body);calls.push({url,input});
 if(String(url).includes('typesafe')){const answers={};for(const [key,q] of Object.entries(input.questions)){
  if(q.type==='score')answers[key]={type:'score',score:3,confidence:.9,probabilities:{0:0,1:0,2:0,3:1,4:0}};
  else if(q.type==='choice'){const choice=options.different?'new':'e0';answers[key]={type:'choice',choice,confidence:.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k=>[k,k===choice?1:0]))};}
  else {const text=input.state.passages[Number(key.slice(1))].text;answers[key]={type:'noul',noul:options.rejectAll?0:input.state.previous?text.includes('新事实')?.98:.01:text.includes('本地部署')?.99:.01};}
 }return Response.json({answers,usage:{input_tokens:100,output_tokens:10}});}
 const data=JSON.parse(input.messages[1].content),a=data.articles[0],p=a.passages.find(p=>p.text.includes('新事实'))||a.passages[0];
 return Response.json({usage:{prompt_tokens:200,completion_tokens:100},choices:[{message:{content:JSON.stringify({sameEvent:true,title:'示例模型发布',summary:p.text,points:[p.text],facts:[{text:p.text,status:'待核验',sources:[a.id],evidenceId:options.badEvidence?'outside':p.id}],opinions:[],evaluations:data.articles.map(a=>({id:a.id,metrics:[80,70,80,70],hype:'低',duplicate:0,reason:'只评价提供的原文片段。',extra:'提供部署细节。',flags:[]})),recommendedArticleId:a.id,conclusion:'阅读原文了解细节。',uncertainty:'仅分析选中的片段，尚未独立核验。'})}}]});};}
const deep=calls=>calls.filter(c=>!c.url.includes('typesafe'));
test('typed Jev decisions reject invented options, missing answers and bad probabilities',()=>{
 const questions={q:{type:'choice',instructions:'choose',criteria:{new:'new',old:'old'}}};
 assert.throws(()=>validateDecisions({answers:{q:{type:'choice',choice:'invented',confidence:.9,probabilities:{new:1,old:0}}}},questions));
 assert.throws(()=>validateDecisions({answers:{}},{q:{type:'noul',instructions:'check'}}));
 assert.throws(()=>validateDecisions({answers:{q:{type:'noul',noul:2}}},{q:{type:'noul',instructions:'check'}}));
});
test('all original spans are judged, boilerplate is removed, decisions cached, and first analysis never receives empty evidence',async()=>{
 const DB=db(),store=new AutomationStore(DB),a=await article('a');const calls=[],fetcher=provider(calls);
 const first=await selectEvidence(store,[a],environment(DB),fetcher);assert.equal(first[0].passages.length,1);assert.equal(first[0].passages[0].text,'示例模型新增本地部署功能。');
 const before=calls.length;assert.deepEqual(await selectEvidence(store,[a],environment(DB),fetcher),first);assert.equal(calls.length,before);
 const fallback=await selectEvidence(store,[a],{...environment(DB),JEV_MODEL:'different'},provider([], {rejectAll:true}));assert.ok(fallback[0].passages.length);DB.close();
});
test('selected-source validation refuses citations from omitted original text',async()=>{
 const a=await article('a'),env=environment();
 await assert.rejects(analyzeArticles([a],env,provider([],{badEvidence:true}),{materials:[{articleId:a.id,passages:[{id:'allowed',text:'示例模型新增本地部署功能。'}]}]}),/evidenceId/);
});
test('selected initial analysis, semantic reuse, important increment and growing copies preserve sources without DeepSeek regrouping',async()=>{
 const DB=db(),store=new AutomationStore(DB),env=environment(DB),calls=[],fetcher=provider(calls);await store.addSource(source);
 const first=await article('a');await store.addArticles(source.id,[first]);await processEvents(store,env,now,fetcher);let [event]=await store.events();assert.equal(event.pending,false);assert.equal(deep(calls).length,1);assert.equal(event.analysisCoverage.mode,'selected');
 assert.ok(deep(calls)[0].input.messages[1].content.length<first.content.length+500);const id=event.id;
 const similar=await article('b','普通复述，没有重要新增信息。');await store.addArticles(source.id,[similar]);await processEvents(store,env,now+1,fetcher);[event]=await store.events();assert.equal(event.id,id);assert.equal(event.articles.length,2);assert.equal(deep(calls).length,1);assert.equal(event.articles.find(a=>a.id==='b').score,undefined);
 const important=await article('c','新事实：模型需要 16GB 显存，支持离线运行。');await store.addArticles(source.id,[important]);await processEvents(store,env,now+2,fetcher);[event]=await store.events();assert.equal(event.id,id);assert.match(event.summary,/16GB/);assert.equal(deep(calls).length,2);assert.ok(event.facts.every(f=>event.articles.some(a=>f.sources.includes(a.id)&&a.content.includes(f.evidence))));
 const prior=deep(calls).length;
 for(let i=0;i<100;i++){const a={...first,id:'copy'+i,source:'受控重复来源 '+i};await store.addSource({id:'s'+i,name:a.source,url:'https://example.test/feed'+i,enabled:true});await store.addArticles('s'+i,[a]);}
 for(let i=0;i<17;i++)await processEvents(store,env,now+3+i,fetcher);
 [event]=await store.events();assert.equal(event.articles.length,103);assert.equal(deep(calls).length,prior);assert.ok(!calls.some(c=>!c.url.includes('typesafe')&&Array.isArray(JSON.parse(c.input.messages[1].content))));assert.match(renderEvents('验收',[event],[]),/原文：https/);DB.close();
});
test('Jev failure keeps old completed event and pending new article; no costly fallback or false completion',async()=>{
 const DB=db(),store=new AutomationStore(DB),env=environment(DB),calls=[];await store.addSource(source);await store.addArticles(source.id,[await article('a')]);await processEvents(store,env,now,provider(calls));const old=(await store.events())[0];
 await store.addArticles(source.id,[await article('b','新事实：重要更新。')]);await assert.rejects(processEvents(store,env,now+1,async()=>new Response('',{status:503})),/HTTP 503/);const events=await store.events();assert.ok(events.some(e=>e.id===old.id&&!e.pending&&e.summary===old.summary));assert.equal(deep(calls).length,1);DB.close();
});
test('many long stored originals are not sent or rejected when selected evidence fits; public full-text limits remain',async()=>{
 const articles=await Promise.all(Array.from({length:13},async(_,i)=>({...await article('long'+i),content:'无意义背景。'.repeat(1800)+'示例模型新增本地部署功能。'})));
 assert.throws(()=>validateInput({articles}),/1–12/);
 assert.throws(()=>validateInput({articles:articles.slice(0,8)}),/72,000/);
 const calls=[];await analyzeArticles(articles,environment(),provider(calls),{materials:articles.map((a,i)=>({articleId:a.id,passages:[{id:'chosen'+i,text:'示例模型新增本地部署功能。'}]}))});
 assert.equal(deep(calls).length,1);assert.ok(!deep(calls)[0].input.messages[1].content.includes('无意义背景'));assert.ok(deep(calls)[0].input.messages[1].content.length<5000);
});
test('different events remain separate and failed incremental analysis retains valid previous report',async()=>{
 const DB=db(),store=new AutomationStore(DB),env=environment(DB),calls=[];await store.addSource(source);await store.addArticles(source.id,[await article('a')]);await processEvents(store,env,now,provider(calls));const old=(await store.events())[0];
 await store.addArticles(source.id,[await article('b','新事实：重要更新。')]);const errors=await processEvents(store,env,now+1,provider(calls,{badEvidence:true}));assert.ok(errors.length);let events=await store.events();assert.ok(events.some(e=>e.id===old.id&&!e.pending&&e.summary===old.summary));assert.ok(events.some(e=>e.pending&&e.articles.some(a=>a.id==='b')));
 await processEvents(store,env,now+2,provider(calls));await store.addArticles(source.id,[{...await article('c','新事实：另一个产品版本。'),title:'示例模型第二代发布'}]);await processEvents(store,env,now+3,provider(calls,{different:true}));events=await store.events();assert.equal(events.filter(e=>!e.pending).length,2);
 assert.equal(invalidateEvent(old,old.articles).analysisCoverage,undefined);DB.close();
});
test('scheduled digest uses selected evidence, preserves original link and does not send twice',async()=>{
 const DB=db(),store=new AutomationStore(DB),calls=[],model=provider(calls),sends=[];await store.addSource(source);await store.addArticles(source.id,[await article('daily')]);
 await store.saveSettings({enabled:true,sendTime:'00:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
 const env={...environment(DB),FEED_ALLOWED_HOSTS:'example.test',FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/test-only'};
 const fetcher=async(url,init)=>{if(String(url)===source.url)return new Response('<rss><channel><title>自编来源</title></channel></rss>',{headers:{'Content-Type':'application/xml'}});if(String(url).includes('open.feishu.cn')){sends.push(JSON.parse(init.body));return Response.json({code:0});}return model(url,init);};
 const result=await runAutomation(env,'scheduled',now+1,fetcher);assert.equal(result.stage,'sent');assert.equal(deep(calls).length,1);assert.equal(sends.length,1);assert.match(sends[0].content.text,/原文：https:\/\/example.test\/daily/);
 const digest=await store.digest(result.digestId);assert.match(digest.body,/未阅读全文/);await runAutomation(env,'scheduled',now+1000,fetcher);assert.equal(sends.length,1);assert.equal((await store.deliveries())[0].status,'sent');DB.close();
});
test('changing preferences cannot merge a new allowed article into old excluded sources',async()=>{
 const DB=db(),store=new AutomationStore(DB),env=environment(DB),calls=[];await store.addSource(source);await store.addArticles(source.id,[await article('old','汽车行业观点。')]);await processEvents(store,env,now,provider(calls));const old=(await store.events())[0];
 await store.savePolicy({...await store.policy(),exclude:['汽车']});await store.addArticles(source.id,[await article('new','新事实：与汽车无关的模型更新。'.replace('与汽车无关的',''))]);await processEvents(store,env,now+1,provider(calls));const events=await store.events();const fresh=events.find(e=>e.articles.some(a=>a.id==='new'));assert.ok(fresh&&!fresh.pending);assert.notEqual(fresh.id,old.id);assert.ok(!fresh.articles.some(a=>a.id==='old'));DB.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseFeed,feedURL,hash} from '../lib/automation/feeds.ts';
import {beijingSchedule,validateSettings,defaultSettings} from '../lib/automation/types.ts';
import {AutomationStore} from '../lib/automation/store.ts';
import {validateGroups} from '../lib/automation/digest.ts';
import {deliveryPayload,sendDelivery,feishuSignature,truncateBytes} from '../lib/automation/delivery.ts';
import {runAutomation} from '../lib/automation/runner.ts';
import {processEvents,renderEvents} from '../lib/automation/events.ts';
import {invalidateEvent} from '../lib/event-state.ts';
import {handleAutomation} from '../lib/automation/api.ts';
const now=Date.parse('2026-10-09T08:15:00+08:00');
const content='示例模型新增本地部署功能。'+ '这是自编的测试正文，说明部署方式与尚未验证的数据。'.repeat(5);
const source={id:'test-source',name:'自编来源',url:'https://feed.example/rss',enabled:true};
function rss(body=content,date='2026-10-09T07:00:00+08:00'){return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><guid>test-article</guid><title>示例模型发布</title><link>https://article.example/a</link><pubDate>${date}</pubDate><description><![CDATA[<p>${body}</p>]]></description></item></channel></rss>`;}
function d1(){const sql=new DatabaseSync(':memory:');for(const entry of JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json',import.meta.url),'utf8')).entries)sql.exec(readFileSync(new URL('../drizzle/'+entry.tag+'.sql',import.meta.url),'utf8'));
  const wrap=(text,args=[])=>({bind(...params){return wrap(text,params)},async first(){return sql.prepare(text).get(...args)||null},async all(){return {results:sql.prepare(text).all(...args),success:true,meta:{}}},async run(){const r=sql.prepare(text).run(...args);return {results:[],success:true,meta:{changes:Number(r.changes)}}}});
  return {prepare:wrap,async batch(statements){sql.exec('BEGIN');try{const r=[];for(const s of statements)r.push(await s.run());sql.exec('COMMIT');return r;}catch(e){sql.exec('ROLLBACK');throw e;}},close(){sql.close()}};
}
function env(DB){return {DB,AUTOMATION_TOKEN:'a'.repeat(32),FEED_ALLOWED_HOSTS:'feed.example',LLM_API_KEY:'fake-model-key',LLM_BASE_URL:'https://model.example/v1',LLM_MODEL:'fake-model',RESEND_API_KEY:'fake-email-key',EMAIL_FROM:'sender@example.test',WECOM_WEBHOOK_URL:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=fake',FEISHU_WEBHOOK_URL:'https://open.feishu.cn/open-apis/bot/v2/hook/fake'};}
function modelResult(articles){return {sameEvent:true,title:'示例模型发布',summary:'新增本地部署功能。',points:['提供本地部署选择。'],facts:[{text:'新增本地部署',status:'待核验',sources:[articles[0].id],evidence:'示例模型新增本地部署功能。'}],opinions:[],evaluations:articles.map(a=>({id:a.id,metrics:[80,60,70,70],hype:'低',duplicate:10,reason:'保留可定位的事实原句。',extra:'解释部署方式。',flags:[]})),conclusion:'需要核对原文的部署要求。',uncertainty:'实际效果尚未验证。'};}
function mockFetch(calls,options={}){return async(url,init={})=>{
  if(url==='https://feed.example/rss'){if(options.feedFails)return new Response('',{status:503});return new Response(rss(options.short?'仅有短摘要。':content));}
  if(url==='https://model.example/v1/chat/completions'){const request=JSON.parse(init.body);const input=JSON.parse(request.messages[1].content);const result=Array.isArray(input)?{groups:input.map(a=>({ids:[a.id]}))}:modelResult(input.articles);return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});}
  calls.push({url,init});if(options.timeout&&String(url).includes('weixin'))throw Error('timeout');
  if(url==='https://api.resend.com/emails')return Response.json({id:'email-test-id'});
  return Response.json(String(url).includes('weixin')?{errcode:0}:{code:0});
};}
test('RSS/Atom parsing strips HTML and excludes old articles without storing unknown dates as ancient news',async()=>{
  assert.equal((await parseFeed(rss().replace('https://article.example/a','http://article.example/a'),source,now)).length,1);
  const a=await parseFeed(rss(),source,now);assert.equal(a.length,1);assert.equal(a[0].content,content);assert.equal((await parseFeed(rss(content,'2026-09-01'),source,now)).length,0);
  const atom=`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>atom-1</id><title>Atom test</title><link href="https://article.example/atom"/><updated>2026-10-09T07:00:00+08:00</updated><content>&lt;p&gt;短摘要&lt;/p&gt;</content></entry></feed>`;
  assert.equal((await parseFeed(atom,source,now))[0].content,'短摘要');
  await assert.rejects(parseFeed('<!DOCTYPE rss [<!ENTITY x "boom">]><rss/>',source,now));
});
test('feed requests require an explicit allowed HTTPS hostname',()=>{
  assert.equal(feedURL(source.url,'feed.example'),source.url);
  for(const url of ['http://feed.example/rss','https://evil.example/rss','https://127.0.0.1/rss','https://user:pass@feed.example/rss','https://feed.example:8443/rss'])assert.throws(()=>feedURL(url,'feed.example,127.0.0.1'));
});
test('Beijing send time has fixed daily windows, and invalid settings are rejected',()=>{
  const schedule=beijingSchedule(now,'08:00');assert.equal(schedule.date,'2026-10-09');assert.equal(schedule.cutoff,Date.parse('2026-10-09T08:00:00+08:00'));assert.equal(schedule.due,true);assert.equal(beijingSchedule(now,'09:00').due,false);
  assert.throws(()=>validateSettings({...defaultSettings,sendTime:'08:07'}));assert.throws(()=>validateSettings({...defaultSettings,enabled:true}));assert.throws(()=>validateSettings({...defaultSettings,channels:{email:true,wecom:false,feishu:false}}));
});
test('SQL migration, article uniqueness and job lease prevent duplicate collection and overlapping jobs',async()=>{
  const DB=d1(),store=new AutomationStore(DB);await store.addSource(source);const articles=await parseFeed(rss(),source,now);
  assert.equal(await store.addArticles(source.id,articles),1);assert.equal(await store.addArticles(source.id,articles),0);
  const holder=await store.acquire(now);assert.ok(holder);assert.equal(await store.acquire(now+1),null);await store.release(holder);assert.ok(await store.acquire(now+2));DB.close();
});
test('semantic grouping rejects unknown IDs, duplicates and omitted articles',async()=>{
  const articles=await parseFeed(rss(),source,now);assert.equal(validateGroups({groups:[{ids:[articles[0].id]}]},articles).length,1);
  for(const groups of [[{ids:['wrong']}],[{ids:[articles[0].id,articles[0].id]}],[]])assert.throws(()=>validateGroups({groups},articles));
});
test('shared events retain copied sources and clear stale analysis on changed membership',async()=>{
  const DB=d1(),store=new AutomationStore(DB);await store.addSource(source);await store.addArticles(source.id,await parseFeed(rss(),source,now));
  await processEvents(store,env(DB),now,mockFetch([]));const [event]=await store.events();assert.equal(event.pending,false);assert.match(renderEvents('2026-10-09',[event],[]),/推荐阅读/);
  const fresh=invalidateEvent(event,event.articles);assert.equal(fresh.pending,true);assert.equal(fresh.facts.length,0);assert.equal(fresh.articles[0].score,undefined);assert.doesNotMatch(fresh.conclusion,/部署要求/);DB.close();
});
test('three delivery protocols respect UTF-8 limits, signatures and provider rejection',async()=>{
  const settings={...defaultSettings,emailTo:'reader@example.test'};const long='汉'.repeat(2000);
  assert.ok(new TextEncoder().encode(truncateBytes(long,1900)).length<=1900);
  assert.equal(deliveryPayload('email','正文','2026-10-09',settings,env()).to[0],settings.emailTo);
  const calls=[];for(const channel of ['email','wecom','feishu'])await sendDelivery(channel,deliveryPayload(channel,long,'2026-10-09',settings,env()),'daily-key',env(),mockFetch(calls),now);
  assert.equal(calls[0].init.headers['Idempotency-Key'],'daily-key');assert.ok(new TextEncoder().encode(JSON.parse(calls[1].init.body).text.content).length<=1900);
  assert.equal(await feishuSignature('123','secret'),createHmac('sha256','123\nsecret').digest('base64'));
  await assert.rejects(sendDelivery('wecom',{},'key',env(),async()=>Response.json({errcode:93000})),/机器人拒绝/);
});
test('daily pipeline collects, analyzes and delivers all three channels exactly once; preview never sends',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);
  await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'reader@example.test',channels:{email:true,wecom:true,feishu:true}});
  await runAutomation(environment,'preview',now,mockFetch(calls));assert.equal(calls.length,0);
  await runAutomation(environment,'scheduled',now,mockFetch(calls));assert.equal(calls.length,3);
  await runAutomation(environment,'scheduled',now+15*60000,mockFetch(calls));assert.equal(calls.length,3);
  assert.equal((await store.deliveries('2026-10-09')).filter(d=>d.status==='sent').length,3);assert.equal((await store.sources())[0].lastSuccess,now+15*60000);DB.close();
});
test('uncertain robot delivery is not blindly retried; failed collection never sends an empty success digest',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:true,feishu:false}});
  await runAutomation(environment,'scheduled',now,mockFetch(calls,{timeout:true}));await runAutomation(environment,'scheduled',now+900000,mockFetch(calls,{timeout:true}));assert.equal(calls.length,1);assert.equal((await store.deliveries())[0].status,'uncertain');
  await assert.rejects(runAutomation(environment,'scheduled',now+86400000,mockFetch(calls,{feedFails:true})),/全部订阅源/);assert.equal(await store.digest('2026-10-10'),null);DB.close();
});
test('automation API requires a management token and same-origin writes',async()=>{
  const DB=d1(),environment=env(DB);
  assert.equal((await handleAutomation(new Request('https://site.test/api/automation'),environment)).status,401);
  const request=new Request('https://site.test/api/automation/settings',{method:'PATCH',headers:{authorization:'Bearer '+environment.AUTOMATION_TOKEN,origin:'https://evil.test','content-type':'application/json'},body:JSON.stringify(defaultSettings)});
  assert.equal((await handleAutomation(request,environment)).status,403);
  assert.equal((await handleAutomation(new Request('https://site.test/api/automation',{headers:{authorization:'Bearer '+environment.AUTOMATION_TOKEN}}),environment)).status,200);DB.close();
});
test('pausing delivery still collects enabled sources without sending',async()=>{
  const DB=d1(),store=new AutomationStore(DB),calls=[];await store.addSource(source);await store.saveSettings(defaultSettings);
  await runAutomation(env(DB),'scheduled',now,mockFetch(calls));assert.equal(calls.length,0);assert.equal((await store.articles(now-86400000,now)).length,1);assert.equal((await store.digests()).length,0);DB.close();
});
test('a channel configured after a failed setup gets a valid payload and retry preserves email data',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'first@example.test',channels:{email:true,wecom:false,feishu:false}});
  await runAutomation({...environment,EMAIL_FROM:undefined},'scheduled',now,mockFetch(calls));assert.equal(calls.length,0);
  await runAutomation(environment,'scheduled',now+900000,mockFetch(calls));assert.equal(calls.length,1);assert.equal(JSON.parse(calls[0].init.body).from,environment.EMAIL_FROM);assert.equal(JSON.parse(calls[0].init.body).to[0],'first@example.test');DB.close();
});

test('late articles survive daily boundaries, overflow queues and durable seen keys',async()=>{
  const DB=d1(),store=new AutomationStore(DB);await store.addSource(source);
  const old=(await parseFeed(rss(content,'2026-10-07T07:00:00+08:00'),source,now))[0];assert.ok(old);
  await store.addArticles(source.id,[old]);assert.equal((await store.pendingArticles(now+1)).length,1);
  await store.saveDigest({id:'day',date:'2026-10-09',status:'generating',body:'',error:'',createdAt:now,preview:false});
  await store.commitDaily({id:'day',body:'frozen'},[old.id]);assert.equal((await store.pendingArticles(now+1)).length,0);
  await DB.prepare('DELETE FROM feed_articles').run();assert.equal(await store.addArticles(source.id,[old]),0);DB.close();
});
test('tracked URL variations and changing GUIDs do not duplicate an article',async()=>{
  const DB=d1(),store=new AutomationStore(DB);await store.addSource(source);const a=(await parseFeed(rss().replace('/a</link>','/a?utm_source=x</link>'),source,now))[0];assert.equal(a.url,'https://article.example/a');
  assert.equal(await store.addArticles(source.id,[a]),1);assert.equal(await store.addArticles(source.id,[{...a,id:'changed-guid',contentHash:'changed',content:a.content+'修改'}]),0);DB.close();
});
test('events API uses persisted data and splitting clears both groups without losing hidden sources',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB);await store.addSource(source);const a=(await parseFeed(rss(),source,now))[0];await store.addArticles(source.id,[a]);await processEvents(store,environment,now,mockFetch([]));
  const [event]=await store.events();event.articles.push({...event.articles[0],id:'second',source:'已暂停来源'});await store.saveEvents([event]);
  const headers={authorization:'Bearer '+environment.AUTOMATION_TOKEN,origin:'https://site.test','content-type':'application/json'};
  const response=await handleAutomation(new Request('https://site.test/api/automation/events/'+event.id+'/split',{method:'POST',headers,body:JSON.stringify({articleId:a.id})}),environment);assert.equal(response.status,200);
  const events=await store.events();assert.equal(events.flatMap(e=>e.articles).length,2);assert.ok(events.every(e=>e.pending&&e.groupingLocked&&!e.facts.length));DB.close();
});
test('overflow is retained across days and only unreported articles enter the next daily queue',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);
  await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
  const entries=Array.from({length:25},(_,i)=>`<item><guid>overflow-${i}</guid><title>事件 ${i}</title><link>https://article.example/${i}</link><pubDate>2026-10-09T07:00:00+08:00</pubDate><description><![CDATA[${content} 编号 ${i}]]></description></item>`).join('');
  const base=mockFetch(calls);const fetcher=async(url,init)=>url===source.url?new Response(`<rss><channel>${entries}</channel></rss>`):base(url,init);
  for(let i=0;i<5;i++)await runAutomation(environment,'collect',now-3600000+i*900000,fetcher);
  await runAutomation(environment,'scheduled',now+5*900000,fetcher);assert.equal(calls.length,1);assert.equal((await store.pendingArticles(now+86400000)).length,1);
  await runAutomation(environment,'scheduled',now+6*900000,fetcher);assert.equal(calls.length,1);
  await runAutomation(environment,'scheduled',now+86400000,fetcher);assert.equal(calls.length,2);assert.equal((await store.pendingArticles(now+2*86400000)).length,0);DB.close();
});

test('Sites migration initializes an empty database and preserves existing local automation data',()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_automation.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_events.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO automation_settings(id,value) VALUES(1,?)').run(JSON.stringify(defaultSettings));
 sql.exec(readFileSync(new URL('../drizzle/0000_clean_beast.sql',import.meta.url),'utf8'));assert.equal(sql.prepare('SELECT count(*) AS count FROM automation_settings').get().count,1);sql.close();
});
test('private Sites bootstrap persists chosen sources once and respects a later pause',async()=>{
 const DB=d1(),store=new AutomationStore(DB);const environment={...env(DB),SITES_PRIVATE_AUTOMATION:'1',FEED_ALLOWED_HOSTS:'www.geekpark.net,www.ithome.com'};
 const fetcher=async(url,init)=>String(url).includes('geekpark.net')||String(url).includes('ithome.com')?new Response('<rss><channel/></rss>'):mockFetch([])(url,init);
 await runAutomation(environment,'collect',now,fetcher);assert.equal((await store.sources()).length,2);assert.equal((await store.settings()).channels.feishu,true);
 await store.saveSettings(defaultSettings);await runAutomation(environment,'collect',now+900000,fetcher);assert.equal((await store.settings()).enabled,false);assert.equal((await store.sources()).length,2);DB.close();
});
test('cloud updater bypass is disabled outside the explicitly configured private Sites boundary',async()=>{
 const DB=d1(),environment=env(DB);
 const request=new Request('https://site.test/api/automation/tick',{method:'POST'});assert.equal((await handleAutomation(request,{...environment,SITES_PRIVATE_AUTOMATION:'1'})).status,401);
 const siteRequest=new Request('https://reader.chatgpt.site/api/automation/tick',{method:'POST'});assert.equal((await handleAutomation(siteRequest,environment)).status,401);DB.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {plainText,parseFeed,feedURL,fetchFeed,hash} from '../lib/automation/feeds.ts';
import {beijingSchedule,validateSettings,defaultSettings} from '../lib/automation/types.ts';
import {AutomationStore} from '../lib/automation/store.ts';
import {clusterArticles,validateGroups} from '../lib/automation/digest.ts';
import {robotBrief,deliveryPayload,sendDelivery,feishuSignature,truncateBytes} from '../lib/automation/delivery.ts';
import {runAutomation,sendReport} from '../lib/automation/runner.ts';
import {processEvents,renderEvents} from '../lib/automation/events.ts';
import {digestLabel,selectHistory,selectReport} from '../lib/automation/presentation.ts';
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
test('feed transport errors retain runtime reasons and redact URLs and credentials',async()=>{
  const error=new TypeError('fetch failed https://feed.example/rss?token=secret-value',{cause:new Error('certificate verify failed sk-fakekey')});
  await assert.rejects(fetchFeed(source,'feed.example',now,async()=>{throw error}),e=>{
    assert.match(e.message,/TypeError: fetch failed/);assert.match(e.message,/certificate verify failed/);
    assert.doesNotMatch(e.message,/secret-value|feed\.example|sk-fakekey/);return true;
  });
  await assert.rejects(fetchFeed(source,'feed.example',now,async()=>{throw new DOMException('deadline exceeded','TimeoutError')}),/TimeoutError/);
});
test('Worker-compatible feed requests never follow redirects outside the allowed source',async()=>{
  const calls=[];
  const fetcher=async(url,init)=>{assert.equal(init.redirect,'manual');calls.push(url);return new Response('',{status:302,headers:{Location:'https://not-allowed.example/rss'}});};
  await assert.rejects(fetchFeed(source,'feed.example',now,fetcher),/HTTP 302 重定向/);
  assert.deepEqual(calls,[source.url]);
  const articles=await fetchFeed(source,'feed.example',now,async(url,init)=>{assert.equal(init.redirect,'manual');return new Response(rss());});
  assert.equal(articles.length,1);
});
test('delivery uses Worker-compatible manual redirects and never forwards credentials or payload',async()=>{
  for(const channel of ['email','wecom','feishu']){
    let calls=0;
    await assert.rejects(sendDelivery(channel,{text:'自编正文'},'test',env(),async(url,init)=>{
      calls++;assert.equal(init.redirect,'manual');return new Response('',{status:307,headers:{Location:'https://not-allowed.example/send'}});
    }),e=>{assert.match(e.message,/重定向/);assert.equal(e.uncertain,true);return true;});
    assert.equal(calls,1);
  }
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
test('checking new articles publishes pending events without waiting for or calling a model',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB);await store.addSource(source);
  let feedCalls=0;const feedOnly=async(url)=>{assert.equal(url,source.url);feedCalls++;return new Response(rss());};
  const first=await runAutomation(environment,'collect',now,feedOnly);assert.equal(first.added,1);
  const [pending]=await store.events();assert.equal(pending.pending,true);assert.equal(pending.articles.length,1);assert.deepEqual(pending.facts,[]);
  assert.deepEqual({...await store.collectionStats()},{articles:1,events:1,analyzedEvents:0,pendingArticles:1});
  const repeat=await runAutomation(environment,'collect',now+1,feedOnly);assert.equal(repeat.added,0);assert.match(repeat.message,/已有文章不会重复入库/);assert.equal((await store.runs()).length,2);
  await processEvents(store,environment,now+2,mockFetch([]));const analyzed=(await store.events())[0];assert.equal(analyzed.pending,false);
  await runAutomation(environment,'collect',now+3,feedOnly);assert.deepEqual((await store.events())[0],analyzed);
  assert.deepEqual({...await store.collectionStats()},{articles:1,events:1,analyzedEvents:1,pendingArticles:0});assert.equal(feedCalls,3);DB.close();
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
  // Background cycles before the daily cutoff analyze queued articles; manual checks do not.
  for(let i=0;i<5;i++)await runAutomation(environment,'scheduled',now-2*3600000+i*900000,fetcher);
  await runAutomation(environment,'scheduled',now+5*900000,fetcher);assert.equal(calls.length,1);assert.equal((await store.pendingArticles(now+86400000)).length,1);
  await runAutomation(environment,'scheduled',now+6*900000,fetcher);assert.equal(calls.length,1);
  await runAutomation(environment,'scheduled',now+86400000,fetcher);assert.equal(calls.length,2);assert.equal((await store.pendingArticles(now+2*86400000)).length,0);DB.close();
});

test('Sites migration initializes an empty database and preserves existing local automation data',()=>{
 const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_automation.sql',import.meta.url),'utf8'));sql.exec(readFileSync(new URL('../migrations/0002_events.sql',import.meta.url),'utf8'));
 sql.prepare('INSERT INTO automation_settings(id,value) VALUES(1,?)').run(JSON.stringify(defaultSettings));
 sql.exec(readFileSync(new URL('../drizzle/0000_clean_beast.sql',import.meta.url),'utf8'));
 sql.prepare("INSERT INTO daily_digests(id,date,status,body,error,created_at,preview) VALUES('old','2026-10-09','ready','自编历史正文','',1,0)").run();
 sql.exec(readFileSync(new URL('../drizzle/0001_same_greymalkin.sql',import.meta.url),'utf8'));
 assert.equal(sql.prepare('SELECT count(*) AS count FROM automation_settings').get().count,1);assert.equal(sql.prepare("SELECT body FROM daily_digests WHERE id='old'").get().body,'自编历史正文');assert.equal(sql.prepare("SELECT details FROM daily_digests WHERE id='old'").get().details,'{}');sql.close();
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

test('temporary source outage does not prevent retrying an already frozen email digest',async()=>{
 const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'reader@example.test',channels:{email:true,wecom:false,feishu:false}});
 await runAutomation({...environment,EMAIL_FROM:undefined},'scheduled',now,mockFetch(calls));const body=(await store.digest('2026-10-09')).body;
 await runAutomation(environment,'scheduled',now+900000,mockFetch(calls,{feedFails:true}));assert.equal(calls.length,1);assert.equal((await store.digest('2026-10-09')).body,body);assert.equal((await store.deliveries())[0].status,'sent');DB.close();
});

test('roundups stay separate from specific events and keep their label in robot messages',async()=>{
  const base=(await parseFeed(rss(),source,now))[0];
  const roundup={...base,id:'roundup',title:'IT早报：自编的三条资讯',content:'1. 模型发布\n2. 手机预约\n3. 公司收购\n'+content};
  const other={...base,id:'other',title:'另一模型发布'};let calls=0;
  const groups=await clusterArticles([base,other,roundup],env(),async(url,init)=>{
    calls++;const input=JSON.parse(JSON.parse(init.body).messages[1].content);assert.deepEqual(input.map(a=>a.id),[base.id,other.id]);
    return Response.json({choices:[{message:{content:JSON.stringify({groups:[{ids:[base.id,other.id]}]})}}]});
  });assert.equal(calls,1);assert.deepEqual(groups.at(-1).map(a=>a.id),['roundup']);
  const body=renderEvents('2026-10-09',[{...modelResult([roundup]),articleKind:'roundup',articles:[{...roundup,score:70,reason:'自编理由'}]}],[]);
  assert.match(body,/综合资讯（多主题）/);assert.match(robotBrief(body),/综合资讯（多主题）/);assert.match(robotBrief(body),/新增本地部署功能/);
  assert.equal(plainText('<p>A &mdash; B &hellip;</p>'),'A — B …');
});
test('manual reanalysis preserves a useful analysis error instead of a generic server failure',async()=>{
  const DB=d1(),store=new AutomationStore(DB);await store.addSource(source);await store.addArticles(source.id,await parseFeed(rss(),source,now));
  await processEvents(store,{},now);const [event]=await store.events();
  const response=await handleAutomation(new Request('https://site.test/api/automation/events/'+event.id+'/analyze',{method:'POST',headers:{Authorization:'Bearer '+env(DB).AUTOMATION_TOKEN,origin:'https://site.test','content-type':'application/json'},body:'{}'}),{...env(DB),LLM_API_KEY:undefined});
  assert.equal(response.status,503);assert.match((await response.json()).message,/AI 服务尚未配置/);assert.equal((await store.events())[0].pending,true);DB.close();
});

test('empty daily attempts do not send or occupy the day, and this cycle collection is eligible',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
  const base=mockFetch(calls);const empty=async(url,init)=>url===source.url?new Response('<rss><channel/></rss>'):base(url,init);
  const initial=await runAutomation(environment,'scheduled',now,empty);assert.equal(initial.stage,'empty');assert.equal(calls.length,0);assert.equal((await store.digest('2026-10-09')).status,'empty');
  const generated=await runAutomation(environment,'scheduled',now+900000,base);assert.equal(generated.stage,'sent');assert.equal(calls.length,1);
  const daily=await store.digest('2026-10-09');assert.equal(daily.details.articleCount,1);assert.match(daily.body,/本次整理 1 条资讯/);
  const repeat=await runAutomation(environment,'scheduled',now+1800000,base);assert.match(repeat.message,/今日已发送，不会重复发送/);assert.equal(calls.length,1);DB.close();
});
test('waiting for analysis is a recoverable state, not a failed preview or a sent empty daily digest',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
  const base=mockFetch(calls);const bad=async(url,init)=>url===environment.LLM_BASE_URL+'/chat/completions'?Response.json({choices:[{message:{content:'{}'}}]}):base(url,init);
  const preview=await runAutomation(environment,'preview',now,bad);assert.equal(preview.stage,'waiting');assert.equal((await store.digest(preview.digestId)).error,'');assert.equal(calls.length,0);
  const daily=await runAutomation(environment,'scheduled',now+1,bad);assert.equal(daily.stage,'waiting');assert.equal((await store.deliveries()).length,0);assert.equal((await store.pendingArticles(now+2)).length,1);
  const repaired=await runAutomation(environment,'scheduled',now+900000,base);assert.equal(repaired.stage,'sent');assert.equal(calls.length,1);DB.close();
});
test('partial previews and daily digests include only valid analyses and leave failed articles queued',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
  const entries=['有效文章','待分析文章'].map((title,i)=>`<item><guid>partial-${i}</guid><title>${title}</title><link>https://article.example/partial-${i}</link><pubDate>2026-10-09T07:00:00+08:00</pubDate><description><![CDATA[${content} 编号 ${i}]]></description></item>`).join('');
  const base=mockFetch(calls);const fetcher=async(url,init)=>{
    if(url===source.url)return new Response(`<rss><channel>${entries}</channel></rss>`);
    if(url===environment.LLM_BASE_URL+'/chat/completions'){
      const input=JSON.parse(JSON.parse(init.body).messages[1].content);
      if(!Array.isArray(input)&&input.articles[0].title==='待分析文章')return Response.json({choices:[{message:{content:JSON.stringify({...modelResult(input.articles),facts:[{text:'不可信陈述',status:'待核验',sources:[input.articles[0].id],evidence:'这是原文不存在的句子'}]})}}]});
    }return base(url,init);
  };
  const preview=await runAutomation(environment,'preview',now,fetcher);const p=await store.digest(preview.digestId);assert.equal(p.status,'ready');assert.equal(p.details.pendingCount,1);assert.equal(p.details.articleCount,1);assert.match(p.body,/有 1 篇文章尚未完成分析/);assert.doesNotMatch(p.body,/这是原文不存在/);assert.equal(calls.length,0);
  const daily=await runAutomation(environment,'scheduled',now+1,fetcher);assert.equal(daily.stage,'sent');assert.equal(calls.length,1);assert.equal((await store.pendingArticles(now+2)).length,1);
  const remaining=(await store.pendingArticles(now+2))[0];assert.equal(remaining.title,'待分析文章');assert.equal((await store.digest('2026-10-09')).details.pendingCount,1);DB.close();
});
test('a legacy empty sent digest is retained and permits exactly one content-bearing correction',async()=>{
  const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
  const body=renderEvents('2026-10-09',[],[]);await store.saveDigest({id:'2026-10-09',date:'2026-10-09',status:'ready',body,error:'',createdAt:now-1000,preview:false});
  await DB.prepare("INSERT INTO digest_deliveries(digest_id,channel,status,attempts,payload) VALUES(?,'feishu','sent',1,'{}')").bind('2026-10-09').run();
  const result=await runAutomation(environment,'scheduled',now,mockFetch(calls));assert.equal(result.digestId,'2026-10-09:content');assert.equal(calls.length,1);assert.equal((await store.digest('2026-10-09')).body,body);assert.equal((await store.digest('2026-10-09')).details.legacyEmpty,true);
  await runAutomation(environment,'scheduled',now+900000,mockFetch(calls));assert.equal(calls.length,1);assert.equal((await store.deliveries()).filter(d=>d.status==='sent').length,2);DB.close();
});
test('delivery response reports rejection and uncertainty instead of unconditional success',async()=>{
  for(const [status,expected] of [[400,'delivery_failed'],[500,'delivery_uncertain']]){
    const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({enabled:true,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:true}});
    const base=mockFetch(calls);const result=await runAutomation(environment,'scheduled',now,async(url,init)=>String(url).includes('open.feishu.cn')?new Response('',{status}):base(url,init));
    assert.equal(result.stage,expected);assert.doesNotMatch(result.message,/发送成功/);DB.close();
  }
});
test('preview history cannot hide daily records or become the selected daily record',async()=>{
  const DB=d1(),store=new AutomationStore(DB);await store.saveDigest({id:'daily',date:'2026-10-09',status:'ready',body:'自编简报',error:'',createdAt:now,preview:false});
  for(let i=0;i<12;i++)await store.saveDigest({id:'preview-'+i,date:'2026-10-09',status:'error',body:'',error:'还有文章等待成功分析，未发送不完整的简报；后续任务会继续处理。',createdAt:now+i+1,preview:true});
  const list=await store.digests();assert.equal(list.filter(d=>!d.preview).length,1);assert.equal(selectHistory(list,false,'preview-11').id,'daily');assert.equal(selectHistory(list,true,'daily').id,'preview-11');assert.equal(digestLabel(list[0]),'等待分析');DB.close();
});

test('a valid empty RSS or Atom feed is a successful check with no articles',async()=>{
  assert.deepEqual(await parseFeed('<rss><channel/></rss>',source,now),[]);
  assert.deepEqual(await parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"/>',source,now),[]);
});

test('manual collection, report and send are separate; explicit send ignores the paused daily schedule',async()=>{
 const DB=d1(),store=new AutomationStore(DB),environment=env(DB),calls=[];await store.addSource(source);await store.saveSettings({...defaultSettings,sendTime:'23:45'});
 let feeds=0,models=0;const base=mockFetch(calls);const fetcher=async(url,init)=>{if(url===source.url)feeds++;if(url===environment.LLM_BASE_URL+'/chat/completions')models++;return base(url,init);};
 await runAutomation(environment,'collect',now,fetcher);assert.equal(feeds,1);assert.equal(models,0);assert.equal(calls.length,0);
 const result=await runAutomation(environment,'report',now+1,fetcher);assert.equal(result.stage,'report');assert.equal(feeds,1);assert.ok(models>0);assert.equal(calls.length,0);
 const frozen=await store.digest(result.digestId);assert.equal(frozen.details.manual,true);assert.match(frozen.body,/科技聚合报告/);
 const [event]=await store.events();await store.saveEvents([{...event,summary:'后来改写的自编内容，不属于这份报告。'}]);
 const count=models;assert.equal((await sendReport(environment,result.digestId,now+2,fetcher)).stage,'sent');assert.equal(models,count);assert.equal(feeds,1);assert.equal(calls.length,1);
 assert.match(JSON.parse(calls[0].init.body).content.text,/新增本地部署功能/);assert.doesNotMatch(JSON.parse(calls[0].init.body).content.text,/后来改写/);assert.equal((await store.digest(result.digestId)).body,frozen.body);
 assert.match((await sendReport(environment,result.digestId,now+3,fetcher)).message,/这份报告已发送，不会重复发送/);assert.equal(calls.length,1);assert.equal((await store.pendingArticles(now+4)).length,1);assert.equal(await store.digest('2026-10-09'),null);DB.close();
});
test('manual sending rejects empty, unknown, expired and concurrent reports',async()=>{
 const DB=d1(),store=new AutomationStore(DB),environment=env(DB);await store.addSource(source);
 const empty=await runAutomation(environment,'report',now,mockFetch([]));assert.equal(empty.stage,'empty');await assert.rejects(sendReport(environment,empty.digestId,now+1,mockFetch([])),/没有可发送/);
 await assert.rejects(sendReport(environment,'report:unknown',now,mockFetch([])),/先生成/);await runAutomation(environment,'collect',now+1,mockFetch([]));const result=await runAutomation(environment,'report',now+2,mockFetch([]));
 await assert.rejects(sendReport(environment,result.digestId,now+24*3600000,mockFetch([])),/超过发送时限/);const holder=await store.acquire(now+3);await assert.rejects(sendReport(environment,result.digestId,now+4,mockFetch([])),/已有任务/);await store.release(holder);DB.close();
});
test('ambiguous manual robot sends are recorded and cannot be resent by repeated clicks',async()=>{
 const DB=d1(),store=new AutomationStore(DB),environment=env(DB);await store.addSource(source);await runAutomation(environment,'collect',now,mockFetch([]));const result=await runAutomation(environment,'report',now+1,mockFetch([]));let sends=0;
 const fail=async()=>{sends++;throw Error('timeout');};assert.equal((await sendReport(environment,result.digestId,now+2,fail)).stage,'delivery_uncertain');await sendReport(environment,result.digestId,now+3,fail);assert.equal(sends,1);assert.equal((await store.deliveries(result.digestId))[0].status,'uncertain');DB.close();
});
test('manual report send endpoint retains authentication and same-origin checks',async()=>{
 const DB=d1(),environment=env(DB),url='https://site.test/api/automation/reports/report:unknown/send';
 assert.equal((await handleAutomation(new Request(url,{method:'POST'}),environment)).status,401);
 const headers={Authorization:'Bearer '+environment.AUTOMATION_TOKEN,origin:'https://evil.test'};assert.equal((await handleAutomation(new Request(url,{method:'POST',headers}),environment)).status,403);
 assert.equal((await handleAutomation(new Request(url,{method:'POST',headers:{...headers,origin:'https://site.test'}}),environment)).status,404);
 await new AutomationStore(DB).saveDigest({id:'report:empty',date:'2026-10-09',status:'empty',body:'',error:'',createdAt:now,preview:true,details:{manual:true,eventCount:0}});
 const encoded=new Request('https://site.test/api/automation/reports/'+encodeURIComponent('report:empty')+'/send',{method:'POST',headers:{...headers,origin:'https://site.test'}});assert.equal((await handleAutomation(encoded,environment)).status,409);DB.close();
});
test('report selection prefers usable content over failures and honors explicit history choices',()=>{
 const daily={id:'daily',status:'ready',body:'自编报告',preview:false},waiting={id:'report:new',status:'waiting',body:'',preview:true,details:{manual:true}};
 assert.equal(selectReport([waiting,daily]).id,'daily');assert.equal(selectReport([waiting,daily],waiting.id).id,waiting.id);assert.equal(selectReport([{...daily,id:'old',details:{legacyEmpty:true}},daily]).id,'daily');
});
test('report includes links to other sources in addition to the recommended article',()=>{
 const body=renderEvents('2026-10-09',[{...modelResult([{id:'a'}]),articles:[{id:'a',title:'自编来源 A',score:80,url:'https://article.example/a'},{id:'b',title:'自编来源 B',score:70,url:'https://article.example/b'}]}],[]);
 assert.match(body,/原文：https:\/\/article.example\/a/);assert.match(body,/参考：自编来源 B｜https:\/\/article.example\/b/);
});

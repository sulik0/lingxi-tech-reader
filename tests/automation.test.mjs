import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {parseFeed,feedURL,hash} from '../lib/automation/feeds.ts';
import {beijingSchedule,validateSettings,defaultSettings} from '../lib/automation/types.ts';
import {AutomationStore} from '../lib/automation/store.ts';
import {validateGroups,buildDigest} from '../lib/automation/digest.ts';
import {deliveryPayload,sendDelivery,feishuSignature,truncateBytes} from '../lib/automation/delivery.ts';
import {runAutomation} from '../lib/automation/runner.ts';
import {handleAutomation} from '../lib/automation/api.ts';
const now=Date.parse('2026-10-09T08:15:00+08:00');
const content='示例模型新增本地部署功能。'+ '这是自编的测试正文，说明部署方式与尚未验证的数据。'.repeat(5);
const source={id:'test-source',name:'自编来源',url:'https://feed.example/rss',enabled:true};
function rss(body=content,date='2026-10-09T07:00:00+08:00'){return `<?xml version="1.0"?><rss version="2.0"><channel><title>Test</title><item><guid>test-article</guid><title>示例模型发布</title><link>https://article.example/a</link><pubDate>${date}</pubDate><description><![CDATA[<p>${body}</p>]]></description></item></channel></rss>`;}
function d1(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_automation.sql',import.meta.url),'utf8'));
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
test('digest removes identical bodies and marks short summaries rather than fabricating analysis',async()=>{
  const a=(await parseFeed(rss(),source,now))[0];const b={...a,id:'copy',source:'转载来源'};const calls=[];
  const body=await buildDigest('2026-10-09',[a,b],env(),[],mockFetch(calls));assert.match(body,/排除 1 篇相同正文/);assert.match(body,/推荐阅读/);assert.match(body,/原句/);
  const short={...a,content:'只有摘要',contentHash:await hash('只有摘要')};const shortBody=await buildDigest('2026-10-09',[short],{},[],async()=>{throw Error('must not call model')});assert.match(shortBody,/只有短摘要，未作质量评分/);
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

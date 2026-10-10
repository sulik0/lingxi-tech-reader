import {filterArticles} from './screening.ts';
import {policyKey} from './policy.ts';
import {meteredFetch} from './meter.ts';
import {isRoundup} from '../roundup.ts';
import {analyzeArticles, configured} from '../analyze.ts';
import type {EventItem} from '../data.ts';
import {AutomationStore} from './store.ts';
import {clusterArticles} from './digest.ts';
import {hash} from './feeds.ts';
import type {AutomationEnv,CollectedArticle} from './types.ts';
const toArticle=(a:CollectedArticle)=>({...a,time:new Date(a.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})});
export function pendingEvent(articles:CollectedArticle[],now:number,id=articles[0].id):EventItem {
  return {articleKind:articles.length===1&&isRoundup(articles[0])?'roundup':undefined,id,automatic:true,updatedAt:now,title:articles[0].title,category:'科技资讯',tag:'自动采集',time:new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),minutes:3,color:'#edf5ee',summary:'已自动采集正文，等待模型分析。',points:[],facts:[],opinions:[],articles:articles.map(toArticle),conclusion:'尚未完成分析，暂不推荐文章。',uncertainty:'正文来自订阅源，尚未独立核实。',demo:false,pending:true};
}
export async function publishCollectedEvents(store:AutomationStore,now:number) {
  // One collection reads at most 10 sources × 50 articles. Existing analysis stays intact.
  const incoming=await store.unprocessed(500,false);
  const events=incoming.map(a=>a.content.length<80
    ? {...pendingEvent([a],now),summary:a.content,uncertainty:'订阅源只有短摘要，未作质量评分。'}
    : pendingEvent([a],now));
  for(let i=0;i<events.length;i+=25)await store.saveEvents(events.slice(i,i+25));
}
export async function processEvents(store:AutomationStore,env:AutomationEnv,now:number,fetcher:typeof fetch=fetch,budget={remaining:12},stats={analyzedIDs:new Set<string>()}) {
  const policy=await store.policy(),key=await policyKey(policy,env);
  const screened=await filterArticles(store,await store.unprocessed(60,configured(env),key),policy,env,now,fetcher,budget);
  const incoming=screened.articles.slice(0,policy.deepLimit);
  if(!incoming.length)return;
  if(!configured(env)){await store.saveEvents(incoming.map(a=>pendingEvent([a],now)));return;}
  const existing=await store.events();
  // Reconsider recent events along with new reports. Never discard an event's hidden articles.
  const candidates:CollectedArticle[]=[];
  const incomingIDs=new Set(incoming.map(a=>a.id));
  for(const event of existing.filter(e=>!e.groupingLocked&&e.articleKind!=='roundup'&&now-(e.updatedAt||0)<48*3600000)) {
    if(event.articles.length+candidates.length>6)continue;
    for(const a of event.articles)if(!incomingIDs.has(a.id))candidates.push({...a,url:a.url||'',publishedAt:a.publishedAt||event.updatedAt||now,collectedAt:event.updatedAt||now,contentHash:await hash(a.content.replace(/\s+/g,''))});
  }
  const allowed=await filterArticles(store,candidates,policy,env,now,fetcher,budget);
  const candidateIDs=new Set(allowed.articles.map(a=>a.id));
  const wholeIDs=new Set(existing.filter(e=>e.articles.every(a=>incomingIDs.has(a.id)||candidateIDs.has(a.id))).flatMap(e=>e.articles.map(a=>a.id)));
  const all=[...incoming,...allowed.articles.filter(a=>wholeIDs.has(a.id))];
  const locked=new Set(existing.filter(e=>e.groupingLocked).flatMap(e=>e.articles.map(a=>a.id)));
  const long=all.filter(a=>a.content.length>=80&&!locked.has(a.id)),short=incoming.filter(a=>a.content.length<80);
  const groups=long.length?await clusterArticles(long,env,meteredFetch(fetcher,store,'group')):[];
  for(const e of existing.filter(e=>e.groupingLocked&&e.articles.some(a=>incomingIDs.has(a.id)))){
    const members=await Promise.all(e.articles.map(async a=>({...a,url:a.url||'',publishedAt:a.publishedAt||now,collectedAt:now,contentHash:await hash(a.content.replace(/\s+/g,''))})));
    const eligible=await filterArticles(store,members,policy,env,now,fetcher,budget);
    if(eligible.articles.length===members.length)groups.push(members);
  }
  const outputs:EventItem[]=[];
  let cursor=0,analysisCalls=0;const reserved=new Set<string>();
  const workers=Array.from({length:Math.min(3,groups.length)},async()=>{while(cursor<groups.length){const group=groups[cursor++];

    // Analyze distinct bodies, retain every source article and identify copied content explicitly.
    const unique=group.filter((a,i)=>group.findIndex(b=>b.contentHash===a.contentHash)===i);
    if(unique.reduce((n,a)=>n+a.content.length,0)>72000)throw new Error('该事件正文超过分析容量，文章已保留，等待调整分组。');
    const prior=existing.find(e=>e.articles.some(a=>group.some(b=>b.id===a.id)));
    const id=prior&&prior.articles.every(a=>group.some(b=>b.id===a.id))&&!reserved.has(prior.id)?prior.id:crypto.randomUUID();reserved.add(id);
    if(prior&&!prior.pending&&prior.articles.length===group.length&&group.every(a=>prior.articles.some(b=>b.id===a.id&&b.content===a.content&&b.title===a.title&&b.source===a.source&&b.author===a.author))){outputs.push(prior);continue;}
    if(analysisCalls>=policy.deepLimit)continue;analysisCalls++;
    const event=pendingEvent(group,now,id);
    let result:Awaited<ReturnType<typeof analyzeArticles>>;
    try{result=await analyzeArticles(unique,env,meteredFetch(fetcher,store,'analysis'));}catch(e){event.summary='文章已保存，模型分析未通过校验。';event.uncertainty=e instanceof Error?e.message:'分析失败。';event.groupingLocked=prior?.groupingLocked;outputs.push(event);continue;}
    stats.analyzedIDs.add(event.id);
    Object.assign(event,result,{pending:false,groupingLocked:prior?.groupingLocked});
    event.articles=group.map(a=>{
      const original=unique.find(b=>b.contentHash===a.contentHash)!;
      const evaluation=result.evaluations.find(e=>e.id===original.id)!;
      return {...toArticle(a),...evaluation,id:a.id,...(original.id!==a.id?{duplicate:100,reason:'正文与同组文章相同，没有新增信息。',extra:'没有新增信息；保留这个来源便于追溯。'}:{})};
    });
    outputs.push(event);
  }});
  const outcomes=await Promise.allSettled(workers);const failure=outcomes.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failure)throw failure.reason;
  outputs.push(...short.map(a=>({...pendingEvent([a],now),summary:a.content,uncertainty:'订阅源只有短摘要，未作质量评分。'})));
  // Remove superseded events and save replacement memberships in one transaction.
  const touched=new Set(outputs.flatMap(e=>e.articles.map(a=>a.id)));
  const obsolete=existing.filter(e=>e.articles.length&&e.articles.every(a=>touched.has(a.id))&&!outputs.some(o=>o.id===e.id));
  await store.saveEvents(outputs,obsolete.map(e=>e.id));
  return outputs.filter(e=>e.pending&&e.articles.some(a=>a.content.length>=80)).map(e=>e.title+'：'+e.uncertainty);
}
export function renderEvents(date:string,events:EventItem[],failures:string[],remaining=false) {
  const lines=[`# 灵析每日科技简报 · ${date}`,'','依据订阅源正文整理；多个来源提及不代表已经独立核实。',`本次整理 ${events.length} 条资讯。`];
  if(remaining)lines.push('还有文章等待后续处理，不会静默丢弃；本次简报不是全部资讯。');
  if(failures.length)lines.push('部分来源读取失败：'+failures.join('；'));
  for(const e of events){const best=e.articles.find(a=>a.id===e.recommendedArticleId)||e.articles.filter(a=>a.score!==undefined).sort((a,b)=>(b.score||0)-(a.score||0))[0];lines.push('',`## ${e.title}`,...(e.articleKind==='roundup'?['综合资讯（多主题）：以下内容来自一篇汇总文章，不代表同一个事件。']:[]),e.summary,...e.points.map(p=>'- '+p),'','事实与依据：',...e.facts.map(f=>`- ${f.text}（${f.status==='来源一致'?'多个来源提及，尚未独立核实':'待核实'}）\n  原句：${f.evidence}`),'','作者观点：',...e.opinions.map(o=>`- ${o.source}：${o.view}（${o.basis}）`),'','文章提供的新信息：',...e.articles.map(a=>`- ${a.title}：${a.extra||'仅有摘要或尚未分析'}${a.duplicate!==undefined?`；重复度 ${a.duplicate}%`:''}${a.flags?.length?'；'+a.flags.join('；'):''}`),...(best?[`推荐阅读：${best.title}`,best.reason||'',`原文：${best.url||''}`]:['没有足够正文，暂不推荐文章。',...e.articles.map(a=>`原文：${a.url||''}`)]),...e.articles.filter(a=>a.url&&a.url!==best?.url).map(a=>`参考：${a.title}｜${a.url}`),`阅读建议：${e.conclusion}`,`尚不确定：${e.uncertainty}`);}
  if(!events.length)lines.push('本次没有尚未发送的新事件。');
  return lines.join('\n');
}

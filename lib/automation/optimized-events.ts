import {analyzeArticles,evidencePassages} from '../analyze.ts';
import type {EventItem} from '../data.ts';
import {pendingEvent} from './events.ts';
import {selectEvidence,routeArticle,type EvidenceMaterial} from './evidence.ts';
import {matchPolicy,policyKey} from './policy.ts';
import {isRoundup} from '../roundup.ts';
import {decisionVersion} from './jev-decisions.ts';
import {meteredFetch} from './meter.ts';
import type {AutomationStore} from './store.ts';
import type {AutomationEnv,CollectedArticle} from './types.ts';
const article=(a:CollectedArticle)=>({...a,time:new Date(a.publishedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})});
const collected=(e:EventItem)=>e.articles.map(a=>({...a,url:a.url||'',publishedAt:a.publishedAt||e.updatedAt||0,collectedAt:e.updatedAt||0,contentHash:''}));
const mergeUnique=<T,>(old:T[],fresh:T[],key:(x:T)=>string)=>[...old.filter(x=>!fresh.some(y=>key(x)===key(y))),...fresh];
/** Jev routes and selects evidence. DeepSeek sees selected passages and bounded prior conclusions. */
export async function processEvidenceEvents(store:AutomationStore,env:AutomationEnv,incoming:CollectedArticle[],now:number,fetcher:typeof fetch,stats:{analyzedIDs:Set<string>},options:{scopeIDs?:string[];onProgress?:(completed:number,total:number)=>Promise<void>}){
 const policy=await store.policy(),existing=await store.events(),scope=options.scopeIDs?new Set(options.scopeIDs):null;
 const recent=existing.filter(e=>!e.pending&&!e.groupingLocked&&e.articleKind!=='roundup'&&now-(e.updatedAt||0)<48*3600000&&e.articles.every(a=>matchPolicy(a,policy).keep)&&(!scope||e.articles.every(a=>scope.has(a.id))));
 const screenings=await store.screenings([...new Set(recent.flatMap(e=>e.articles.map(a=>a.id)))],await policyKey(policy,env));
 // Changed preferences must not reintroduce old excluded or not-yet-screened sources through an update.
 const candidates=recent.filter(e=>e.articles.every(a=>screenings.get(a.id)?.keep));
 const groups:{id:string;prior?:EventItem;incoming:CollectedArticle[]}[]=[],failures:string[]=[];
 for(const a of incoming){
  try{
   const locked=existing.find(e=>e.groupingLocked&&e.articles.some(b=>b.id===a.id));
   if(locked&&(!locked.articles.every(b=>matchPolicy(b,policy).keep)||scope&&!locked.articles.every(b=>scope.has(b.id))))throw Error('手动分组包含不符合当前报告要求的文章，请先调整分组。');
   let match=locked;
   if(!match&&!isRoundup(a)){
    match=candidates.find(e=>e.articles.some(b=>b.content.replace(/\s/g,'')===a.content.replace(/\s/g,'')));
    if(!match)match=await routeArticle(store,a,[...candidates,...groups.filter(g=>!g.prior).map(g=>pendingEvent(g.incoming,now,g.id))],env,fetcher);
   }
   let group=match?groups.find(g=>g.id===match.id):undefined;
   if(!group){group={id:match?.id||crypto.randomUUID(),prior:match&&!match.pending?match:undefined,incoming:[]};groups.push(group);}
   if(locked?.pending)group.incoming=collected(locked);else if(!group.incoming.some(b=>b.id===a.id))group.incoming.push(a);
  }catch(e){failures.push(a.title+'：'+(e instanceof Error?e.message:'Jev 判断失败。'));const pending=pendingEvent([a],now);await store.saveEvents([pending]);}
 }
 let done=0;await options.onProgress?.(0,groups.length);
 for(const group of groups){
  const prior=group.prior,fresh=group.incoming.filter(a=>!prior?.articles.some(b=>b.id===a.id));
  const articles=mergeUnique(prior?collected(prior):[],group.incoming,a=>a.id);
  try{
   const toReview=prior?fresh:group.incoming;
   const nonCopies=toReview.filter(a=>!prior?.articles.some(b=>b.content.replace(/\s/g,'')===a.content.replace(/\s/g,'')));
   const materials=await selectEvidence(store,nonCopies,env,fetcher,prior);
   const newMaterials=materials.filter(m=>m.passages.length),active=nonCopies.filter(a=>newMaterials.some(m=>m.articleId===a.id));
   const coverageNote='本报告依据 Jev 筛选的原文片段，未阅读全文；可能遗漏未选中的细节。';
   let event:EventItem;
   if(prior&&!active.length){
    event={...prior,updatedAt:now,articles:mergeUnique(prior.articles,fresh.map(a=>({...article(a),reason:'Jev 未发现值得更新报告的新信息，未单独作质量评分。',extra:'保留原文链接；已有分析沿用。',...(prior.articles.some(b=>b.content.replace(/\s/g,'')===a.content.replace(/\s/g,''))?{duplicate:100}: {})})),a=>a.id),analysisCoverage:{version:decisionVersion,mode:'selected',materials:prior.analysisCoverage?.materials||[],reviewedArticleIds:prior.analysisCoverage?.reviewedArticleIds||prior.articles.map(a=>a.id),reusedArticleIds:[...new Set([...(prior.analysisCoverage?.reusedArticleIds||[]),...fresh.map(a=>a.id)])]}};
    if(!event.uncertainty.includes('未阅读全文'))event.uncertainty+=' '+coverageNote;
   }else{
    if(!active.length)throw Error('没有可供分析的原文，文章已保留。');
    // Retain only one representative's old evidence as grounding, not all old bodies.
    if(prior){const anchor=prior.articles.find(a=>a.id===prior.recommendedArticleId)||prior.articles[0];
     if(anchor&&!active.some(a=>a.id===anchor.id)){
      const saved=prior.analysisCoverage?.materials.find(m=>m.articleId===anchor.id);
      const quotes=prior.facts.filter(f=>f.sources.includes(anchor.id)&&anchor.content.includes(f.evidence)).map((f,i)=>({id:'old'+i,text:f.evidence}));
      const spans=quotes.length?quotes:saved?.passages||evidencePassages([anchor])[0].passages.slice(0,1);
      active.push({...anchor,url:anchor.url||'',publishedAt:anchor.publishedAt||now,collectedAt:now,contentHash:''});newMaterials.push({articleId:anchor.id,passages:spans.map((p,i)=>({id:'old'+i,text:p.text}))});
     }
    }
    const previous=prior?{title:prior.title,summary:prior.summary,points:prior.points,facts:prior.facts.map(f=>({text:f.text,status:f.status})),conclusion:prior.conclusion,uncertainty:prior.uncertainty,recommendedArticleId:prior.recommendedArticleId,recommendationReason:prior.articles.find(a=>a.id===prior.recommendedArticleId)?.reason}:undefined;
    const result=await analyzeArticles(active,env,meteredFetch(fetcher,store,prior?'analysis_incremental':'analysis_initial'),{materials:newMaterials,previous});
    event={...pendingEvent(articles,now,group.id),...result,pending:false,groupingLocked:prior?.groupingLocked};
    // Every retained old fact still carries its original source and verbatim quote.
    if(prior){event.facts=mergeUnique(prior.facts.map(f=>({...f,text:f.text.startsWith('此前报道：')?f.text:'此前报道：'+f.text})),result.facts,f=>f.text.replace(/^此前报道：/,'')).slice(-18);event.opinions=mergeUnique(prior.opinions,result.opinions,o=>o.source+o.view).slice(-18);}
    event.articles=articles.map(a=>{const evaluation=result.evaluations.find(e=>e.id===a.id);return evaluation?{...article(a),...evaluation}:prior?.articles.find(b=>b.id===a.id)||{...article(a),reason:'仅经 Jev 判断，未交给摘要模型作质量评分。',extra:'未选到需要更新报告的原文片段，保留来源链接。'};});
    event.uncertainty+=' '+coverageNote;
    event.analysisCoverage={version:decisionVersion,mode:'selected',materials:newMaterials,reviewedArticleIds:[...new Set([...(prior?.analysisCoverage?.reviewedArticleIds||[]),...active.map(a=>a.id)])],reusedArticleIds:[...new Set([...(prior?.analysisCoverage?.reusedArticleIds||[]),...fresh.filter(a=>!active.some(b=>b.id===a.id)).map(a=>a.id)])]};
    stats.analyzedIDs.add(event.id);
   }
   const touched=new Set(event.articles.map(a=>a.id));const obsolete=existing.filter(e=>e.id!==event.id&&e.articles.every(a=>touched.has(a.id))).map(e=>e.id);
   await store.saveEvents([event],obsolete);
  }catch(e){const error=e instanceof Error?e.message:'分析失败。';failures.push(group.incoming[0].title+'：'+error);
   // Never destroy a valid old report when an incremental request fails.
   const pending=pendingEvent(prior?fresh:group.incoming,now);if(pending.articles.length){pending.uncertainty=error;await store.saveEvents([pending]);}
  }
  done++;await options.onProgress?.(done,groups.length);
 }
 return failures;
}

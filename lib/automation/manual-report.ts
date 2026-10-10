import {configured} from '../analyze.ts';
import type {EventItem} from '../data.ts';
import {processEvents,renderEvents} from './events.ts';
import {policyKey} from './policy.ts';
import {filterArticles} from './screening.ts';
import {selectDigestEvents} from './selection.ts';
import type {AutomationStore} from './store.ts';
import {AutomationError,beijingSchedule,type AutomationEnv,type Digest,type ReportProgress} from './types.ts';

/** One bounded batch against a fixed, resumable report; it never collects or sends. */
export async function runManualReport(store:AutomationStore,env:AutomationEnv,now:number,fetcher:typeof fetch,reportId?:string){
  const policy=await store.policy(),key=await policyKey(policy,env);
  if(!configured(env))throw new AutomationError('分析模型尚未配置，无法生成报告。',503);
  let digest:Digest;
  if(reportId){
    const saved=await store.digest(reportId);
    if(!saved?.details?.manual||!saved.details.scope)throw new AutomationError('旧报告没有固定处理范围，请检查新资讯生成一份新报告。',409);
    if(saved.details.scope.policyKey!==key)throw new AutomationError('偏好或初筛要求已改变，请生成新报告，避免混用不同要求。',409);
    if(now-saved.createdAt>=23*3600000)throw new AutomationError('这份报告已超过 23 小时，请生成新报告。',409);
    if((await store.deliveries(reportId)).some(d=>['sent','sending','uncertain'].includes(String(d.status))))throw new AutomationError('这份报告已经发送或正在确认送达，不能改写；请生成新报告。',409);
    if(saved.details.progress?.stage==='complete')return {stage:'report',digestId:saved.id,complete:true,canContinue:false,message:'这份报告已完成，无需重复分析。'};
    digest=saved;
  }else{
    const rows=await store.articles(now-86400000,now+1);
    digest={id:`report:${now}:${crypto.randomUUID()}`,date:beijingSchedule(now,'00:00').date,status:'generating',body:'',error:'',createdAt:now,preview:true,details:{manual:true,policy:{include:policy.include,exclude:policy.exclude},scope:{articleIds:rows.slice(0,240).map(a=>a.id),policyKey:key,limited:rows.length>240}}};
  }
  const ids=digest.details!.scope!.articleIds,articles=await store.articlesByIDs(ids),budget={remaining:12},stats={analyzedIDs:new Set<string>()};
  const failures:string[]=[];
  const previous=digest.details?.progress;
  const progress:ReportProgress={stage:'screening',total:ids.length,completed:previous?.completed||0,filtered:previous?.filtered||0,pending:previous?.pending??ids.length,batchCompleted:0,batchTotal:0,rounds:(previous?.rounds||0)+1,updatedAt:Date.now(),failures:[],message:'正在初筛本次资讯并整理事件。'};
  const update=async()=>{progress.updatedAt=Date.now();digest.details={...digest.details,progress:{...progress,failures:[...progress.failures]}};await store.saveDigest(digest);};
  digest.status='generating';digest.error='';await update();
  try{
    try{const errors=await processEvents(store,env,now,fetcher,budget,stats,{scopeIDs:ids,onProgress:async(completed,total)=>{progress.stage='analyzing';progress.batchCompleted=completed;progress.batchTotal=total;progress.message=`本批已处理 ${completed} / ${total} 个事件，正在核对分析结果。`;await update();}});failures.push(...(errors||[]));}
    catch(e){budget.remaining=0;failures.push(e instanceof Error?e.message:'分析失败，文章已保留。');}
    progress.stage='rendering';progress.message='正在合并已通过校验的分析并核对剩余文章。';await update();
    let screened:Awaited<ReturnType<typeof filterArticles>>;
    try{screened=await filterArticles(store,articles,policy,env,now,fetcher,budget);}
    catch(e){failures.push(e instanceof Error?e.message:'初筛失败。');screened=await filterArticles(store,articles,policy,env,now,fetcher,{remaining:0});}
    const allowed=new Set(screened.articles.map(a=>a.id));
    const candidates=(await store.events()).filter(e=>e.articles.length&&e.articles.every(a=>allowed.has(a.id)));
    const selection=selectDigestEvents(screened.articles,candidates,240);
    const pending=Math.max(0,ids.length-screened.skipped-selection.articleCount);
    if(pending&&!failures.length&&!screened.waiting&&!stats.analyzedIDs.size)failures.push(`有 ${pending} 篇文章还没有可用分析，当前分组可能包含范围外文章，或来源已停用。请检查来源并重新生成报告；不会自动反复调用模型。`);
    progress.completed=selection.articleCount;progress.filtered=screened.skipped;progress.pending=pending;
    progress.failures=[...new Set(failures)].slice(0,20);
    progress.stage=pending?(failures.length?'failed':'paused'):'complete';
    progress.message=pending?(failures.length?'处理遇到错误，已保留通过校验的内容；修复或重试后继续这份报告。':'本批处理结束，还有文章待处理。继续这份报告会复用已完成结果。'):(selection.events.length?'本次选定资讯已全部处理，报告已完成。':'本次没有符合要求且可纳入报告的资讯。');
    digest.status=selection.events.length?'ready':pending?'waiting':'empty';
    digest.body=selection.events.length?renderEvents(digest.date,selection.events,[],pending>0).replace('# 灵析每日科技简报','# 灵析科技聚合报告'):'';
    if(pending&&digest.body)digest.body+=`\n\n本次有 ${pending} 篇文章尚未处理完成，未包含在这份报告中。`;
    const scope=[policy.include.length?'关注：'+policy.include.join('、'):'',policy.exclude.length?'排除：'+policy.exclude.join('、'):''].filter(Boolean).join('；');
    if(scope&&digest.body)digest.body+='\n\n本报告采用的搜集要求：'+scope+'。';
    digest.details={...digest.details,articleCount:selection.articleCount,eventCount:selection.events.length,pendingCount:pending,remainingCount:pending,filteredCount:screened.skipped,analysisReused:selection.events.filter(e=>!stats.analyzedIDs.has(e.id)).length,completedAt:pending?undefined:Date.now()};
    await update();await store.collectionRun(now,0,progress.failures);
    return {stage:selection.events.length?'report':digest.status,digestId:digest.id,complete:!pending,canContinue:!!pending&&!failures.length,failures:progress.failures,processed:progress.completed+progress.filtered,message:progress.message+' 没有发送到任何渠道。'};
  }catch(e){digest.status='error';digest.error=e instanceof Error?e.message:'报告生成失败。';progress.stage='failed';progress.failures=[digest.error];progress.message='处理已停止，已保存的文章和分析结果会保留。';await update();throw e;}
}

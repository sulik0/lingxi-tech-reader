import {AutomationStore} from './store.ts';
import {matchPolicy,policyKey,screeningEnv,type CollectionPolicy} from './policy.ts';
import {screenArticles} from './jev.ts';
import {meteredFetch} from './meter.ts';
import type {AutomationEnv,CollectedArticle} from './types.ts';
export async function filterArticles(store:AutomationStore,articles:CollectedArticle[],policy:CollectionPolicy,env:AutomationEnv,now:number,fetcher:typeof fetch=fetch,budget={remaining:12}){
  const key=await policyKey(policy,env),accepted:CollectedArticle[]=[],pending:CollectedArticle[]=[];let skipped=0,reused=0;
  const cached=await store.screenings(articles.map(a=>a.id),key);
  for(const a of articles){const rule=matchPolicy(a,policy);
    if(!rule.keep){skipped++;if(!cached.has(a.id))await store.saveScreening(a.id,key,false,rule.reason,'rule',now);continue;}
    const prior=cached.get(a.id);
    if(prior){if(prior.keep)accepted.push(a);else skipped++;reused++;continue;}
    if(!policy.screenEnabled||!screeningEnv(env)){accepted.push(a);continue;}
    pending.push(a);
  }
  const batch=pending.slice(0,Math.max(0,budget.remaining));
  if(batch.length){budget.remaining-=batch.length;const decisions=await screenArticles(batch,policy,env,meteredFetch(fetcher,store,'screen'));
    for(const result of decisions){await store.saveScreening(result.id,key,result.keep,result.reason,'model',now);if(result.keep)accepted.push(batch.find(a=>a.id===result.id)!);else skipped++;}
  }
  const order=new Map(articles.map((a,i)=>[a.id,i]));accepted.sort((a,b)=>order.get(a.id)!-order.get(b.id)!);
  return {articles:accepted,skipped,reused,key,waiting:pending.length-batch.length};
}

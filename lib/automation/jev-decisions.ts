import {AutomationError,type AutomationEnv} from './types.ts';
import {screeningEnv} from './policy.ts';
import {readLimited,hash} from './feeds.ts';
import type {AutomationStore} from './store.ts';
import {meteredFetch} from './meter.ts';
export type DecisionQuestion={type:'noul';instructions:string}|{type:'choice';instructions:string;criteria:Record<string,string>};
export type DecisionAnswer={type:'noul';noul:number}|{type:'choice';choice:string;confidence:number;probabilities:Record<string,number>};
export const decisionVersion='evidence-1';
export function validateDecisions(raw:any,questions:Record<string,DecisionQuestion>):Record<string,DecisionAnswer>{
 const result:Record<string,DecisionAnswer>={};
 const probability=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1;
 for(const [id,q] of Object.entries(questions)){
  const a=raw?.answers?.[id];if(a?.type!==q.type)throw new AutomationError('Jev 判断结果缺少字段，文章已保留。',502);
  if(q.type==='noul'){if(!probability(a.noul))throw new AutomationError('Jev 判断概率无效，文章已保留。',502);result[id]={type:'noul',noul:a.noul};}
  else {const keys=Object.keys(q.criteria),p=a.probabilities;
   if(!keys.includes(a.choice)||!probability(a.confidence)||!p||Object.keys(p).length!==keys.length||keys.some(k=>!probability(p[k]))||Math.abs(keys.reduce((n,k)=>n+p[k],0)-1)>keys.length*.005+1e-9||keys.some(k=>p[k]>p[a.choice]+.011))throw new AutomationError('Jev 归类结果无效，文章已保留。',502);
   result[id]={type:'choice',choice:a.choice,confidence:a.confidence,probabilities:p};
  }
 }
 return result;
}
/** Cache exact decisions, including model, content and prior evidence. Never cache failures. */
export async function decide(store:AutomationStore,articleId:string,stage:string,state:unknown,questions:Record<string,DecisionQuestion>,env:AutomationEnv,fetcher:typeof fetch):Promise<Record<string,DecisionAnswer>>{
 const config=screeningEnv(env);if(!config)throw new AutomationError('Jev 尚未配置。',503);
 const key='decision:'+await hash(JSON.stringify({version:decisionVersion,model:config.model,stage,state,questions}));
 const cached=await store.screening(articleId,key);
 if(cached){try{return validateDecisions({answers:JSON.parse(cached.reason)},questions);}catch{}}
 let response:Response;try{response=await meteredFetch(fetcher,store,stage)('https://api.typesafe.ai/v1/systemone',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+env.JEV_API_KEY?.trim(),'Content-Type':'application/json'},body:JSON.stringify({model:config.model,state,questions})});}catch{throw new AutomationError('Jev 判断连接失败，文章已保留，稍后可继续。',502);}
 if(!response.ok)throw new AutomationError(`Jev 判断失败（HTTP ${response.status}），文章已保留。`,502);
 let answers:Record<string,DecisionAnswer>;try{answers=validateDecisions(JSON.parse(await readLimited(response,180000)),questions);}catch(e){if(e instanceof AutomationError)throw e;throw new AutomationError('Jev 判断结果无法读取，文章已保留。',502);}
 await store.saveScreening(articleId,key,true,JSON.stringify(answers),stage,Date.now());return answers;
}

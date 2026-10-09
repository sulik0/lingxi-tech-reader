import {readFileSync,writeFileSync} from 'node:fs';
import {clusterArticles} from '../lib/automation/digest.ts';
import {analyzeArticles} from '../lib/analyze.ts';
const path=process.argv[2];if(!path)throw Error('用法：node --env-file=.dev.vars scripts/evaluate-quality.mjs work/quality/cases.json');
const cases=JSON.parse(readFileSync(path,'utf8'));
if(!Array.isArray(cases)||cases.length<10||cases.length>30)throw Error('需要人工标注的 10–30 个事件案例。');
if(cases.some(c=>!c.reviewed||!Array.isArray(c.articles)||c.articles.length<2||!Array.isArray(c.expectedGroups)||!c.expectedGroups.length||!c.expectedBest||!Array.isArray(c.expectedDuplicates)||!Array.isArray(c.expectedGains)))throw Error('案例必须经过人工审核，包含多个来源、分组、推荐文章、重复关系和新增信息，不能用空模板冒充测试集。');
const env=Object.fromEntries(['LLM_API_KEY','LLM_BASE_URL','LLM_MODEL'].map(k=>[k,process.env[k]]));
const reports=[];
for(const c of cases){try{
  const groups=await clusterArticles(c.articles,env);const assignments=new Map(groups.flatMap((g,i)=>g.map(a=>[a.id,i]))),expected=new Map(c.expectedGroups.flatMap((g,i)=>g.map(id=>[id,i])));
  if(expected.size!==c.articles.length||c.articles.some(a=>!expected.has(a.id)))throw Error('人工分组必须覆盖每篇文章且不能重复。');
  let tp=0,fp=0,fn=0;for(let i=0;i<c.articles.length;i++)for(let j=i+1;j<c.articles.length;j++){const a=c.articles[i].id,b=c.articles[j].id,actual=assignments.get(a)===assignments.get(b),truth=expected.get(a)===expected.get(b);if(actual&&truth)tp++;if(actual&&!truth)fp++;if(!actual&&truth)fn++;}
  const results=[];for(const group of groups)results.push(await analyzeArticles(group,env));
  const evaluations=results.flatMap(r=>r.evaluations);
  reports.push({name:c.name,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,falseMerges:fp,missedMerges:fn,recommendedMatch:results.some(r=>r.recommendedArticleId===c.expectedBest),duplicates:c.expectedDuplicates.map(id=>({id,actual:evaluations.find(e=>e.id===id)?.duplicate})),gainsForHumanReview:c.expectedGains.map(g=>({expected:g,actual:evaluations.find(e=>e.id===g.id)?.extra})),results});
}catch(e){reports.push({name:c.name,error:e.message});}}
writeFileSync(path.replace(/\.json$/,'.results.json'),JSON.stringify({model:env.LLM_MODEL,runAt:new Date().toISOString(),reports},null,2));console.log(JSON.stringify({cases:cases.length,completed:reports.filter(r=>!r.error).length,errors:reports.filter(r=>r.error).map(r=>({name:r.name,error:r.error}))}));

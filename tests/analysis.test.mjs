import test from 'node:test';
import assert from 'node:assert/strict';
import {validateInput,validateResult,locateEvidence,analyzeArticles,handleAnalysis} from '../lib/analyze.ts';
const a={id:'a1',title:'模型 A 发布',source:'来源一',author:'作者一',content:'模型 A 提供两种部署规模。'+ '可验证的导入文章正文。'.repeat(12)};
const b={...a,id:'a2',source:'来源二',content:'模型 A 提供两种部署规模。'+ '第二篇文章提供独立解读。'.repeat(12)};
const result={sameEvent:true,title:'模型 A 发布',summary:'发布了两个部署规模。',points:['两种规模。'],facts:[{text:'提供两种规模',status:'来源一致',sources:['a1','a2'],evidence:'模型 A 提供两种部署规模。'}],opinions:[{author:'作者一',source:'来源一',view:'部署更灵活',basis:'作者根据规模选择的判断。'}],evaluations:[a,b].map(x=>({id:x.id,metrics:[90,80,90,70],hype:'低',duplicate:35,reason:'保留一手陈述与判断边界',extra:'比较部署选择',flags:[]})),conclusion:'可按部署需求查看原文',uncertainty:'真实运行成本需要测试'};
test('reject duplicate IDs, short body and oversized batches',()=>{assert.throws(()=>validateInput({articles:[a,a]}));assert.throws(()=>validateInput({articles:[{...a,content:'too short'}]}));assert.throws(()=>validateInput({articles:Array.from({length:13},(_,i)=>({...a,id:String(i)}))}));assert.equal(validateInput({articles:[a,b]}).length,2)});
test('weighted score is server-derived and facts have verbatim evidence',()=>{const r=validateResult(result,[a,b]);assert.equal(r.evaluations[0].score,84);assert.equal(r.facts[0].evidence,'模型 A 提供两种部署规模。')});
test('reject invented citations and unwarranted verified status',()=>{for(const delta of [{sources:['bogus']},{status:'已核验'},{evidence:'原文没有这句话'},{sources:['a1']}])assert.throws(()=>validateResult({...result,facts:[{...result.facts[0],...delta}]},[a,b]));assert.throws(()=>validateResult({...result,evaluations:[result.evaluations[0],result.evaluations[0]]},[a,b]))});
test('different events cannot be forcibly analyzed as one',()=>{assert.throws(()=>validateResult({sameEvent:false},[a,b]),e=>e.status===422)});
test('unconfigured backend never fabricates AI output',async()=>{await assert.rejects(analyzeArticles([a],{}),e=>e.status===503)});
test('cross-origin and invalid requests fail before provider calls',async()=>{const response=await handleAnalysis(new Request('https://site.test/api/analyze',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:JSON.stringify({articles:[a]})}),{});assert.equal(response.status,403);const notReady=await handleAnalysis(new Request('https://site.test/api/analyze',{method:'POST',headers:{origin:'https://site.test','content-type':'application/json'},body:JSON.stringify({articles:[a]})}),{});assert.equal(notReady.status,503);assert.match(notReady.headers.get('cache-control'),/no-store/)});
test('provider response contract accepts valid evidence and hides provider errors',async()=>{const env={LLM_API_KEY:'test-key',LLM_BASE_URL:'https://provider.test/v1',LLM_MODEL:'test-model'};const r=await analyzeArticles([a,b],env,async(url,init)=>{assert.equal(url,'https://provider.test/v1/chat/completions');assert.equal(init.headers.Authorization,'Bearer test-key');return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(result)}}]}))});assert.equal(r.evaluations.length,2);await assert.rejects(analyzeArticles([a],env,async()=>new Response('secret',{status:401})),e=>!e.message.includes('secret')&&e.status===502)});

test('evidence restores exact source whitespace and HTML entities but rejects rewritten or joined text',()=>{
  const original='第一段 A &mdash; B。\n\n第二段售价 199 元。\n不能跳过本段。\n最后一段。';
  assert.equal(locateEvidence(original,'第一段 A — B。 第二段售价 199 元。'),'第一段 A &mdash; B。\n\n第二段售价 199 元。');
  assert.equal(locateEvidence(original,'第二段售价 299 元。'),undefined);
  assert.equal(locateEvidence(original,'第二段售价 199 元。最后一段。'),undefined);
  const altered={...a,content:original+'正文。'.repeat(30)};
  const valid=validateResult({...result,evaluations:[result.evaluations[0]],facts:[{text:'售价 199 元',status:'待核验',sources:['a1'],evidence:'第一段 A — B。 第二段售价 199 元。'}],recommendedArticleId:'a1'},[altered]);
  assert.ok(altered.content.includes(valid.facts[0].evidence));
});
test('only single explicitly marked roundups can contain multiple topics',()=>{
  const solo={...result,sameEvent:false,articleKind:'roundup',evaluations:[result.evaluations[0]],facts:[]};
  assert.equal(validateResult(solo,[a]).articleKind,'roundup');
  const early={...a,title:'IT早报：测试汇总',content:'1. 自编新闻一\n2. 自编新闻二\n3. 自编新闻三\n'+a.content};
  assert.throws(()=>validateResult({...solo,sameEvent:true,articleKind:'event'},[early]),/多主题综合早报/);
  assert.equal(validateResult(solo,[early]).articleKind,'roundup');
  assert.throws(()=>validateResult({...solo,evaluations:result.evaluations},[a,b]),e=>e.status===422);
  assert.throws(()=>validateResult({...solo,sameEvent:true},[a]),e=>e.status===422);
});
test('retry reports the actual field limit and never silently drops extra points',async()=>{
  const env={LLM_API_KEY:'test',LLM_BASE_URL:'https://provider.test',LLM_MODEL:'test'};let calls=0;
  const valid={...result,evaluations:[result.evaluations[0]],facts:[]};
  const output=await analyzeArticles([a],env,async(url,init)=>{
    const request=JSON.parse(init.body);calls++;
    if(calls===2)assert.match(request.messages.at(-1).content,/points 最多 10 条，实际 11 条/);
    return Response.json({choices:[{message:{content:JSON.stringify(calls===1?{...valid,points:Array(11).fill('自编要点')}:valid)}}]});
  });assert.equal(calls,2);assert.equal(output.points.length,1);
});
test('truncated JSON gets one concise retry; persistent invalid JSON still fails',async()=>{
  const env={LLM_API_KEY:'test',LLM_BASE_URL:'https://provider.test',LLM_MODEL:'test'};let calls=0;
  await assert.rejects(analyzeArticles([a],env,async(url,init)=>{
    calls++;if(calls===2)assert.match(JSON.parse(init.body).messages.at(-1).content,/输出达到长度限制/);
    return Response.json({choices:[{finish_reason:'length',message:{content:'{"sameEvent":true'}}]});
  }),/输出达到长度限制/);assert.equal(calls,2);
});

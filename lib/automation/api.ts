import {parseInstruction,validatePolicy,screeningEnv} from './policy.ts';
import {meteredFetch} from './meter.ts';
import { invalidateEvent } from '../event-state.ts';
import { AnalysisError, analyzeArticles } from '../analyze.ts';
import { AutomationStore } from './store.ts';
import { feedURL } from './feeds.ts';
import { channelReady } from './delivery.ts';
import { runAutomation, sendReport } from './runner.ts';
import { AutomationError, suggestedFeeds, validateSettings, type AutomationEnv } from './types.ts';
async function authorized(request:Request,token:string) {
  const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [a,b]=await Promise.all([digest(supplied),digest(token)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function handleAutomation(request:Request,env:AutomationEnv) {
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
  try{
    // Sites dispatch authenticates this owner-private service endpoint before the Worker.
    // Keep the flag disabled on any deployment without that platform boundary.
    const incomingURL=new URL(request.url);
    if(incomingURL.pathname==='/api/automation/tick'&&request.method==='POST'&&env.SITES_PRIVATE_AUTOMATION==='1'&&incomingURL.hostname.endsWith('.chatgpt.site'))return json(await runAutomation(env,'scheduled'));
    if(!env.DB||!env.AUTOMATION_TOKEN||env.AUTOMATION_TOKEN.length<24)throw new AutomationError('自动订阅尚未配置。请先设置后台数据库和至少 24 位的管理口令。',503);
    if(!await authorized(request,env.AUTOMATION_TOKEN))throw new AutomationError('请输入正确的管理口令。',401);
    const url=new URL(request.url);const path=url.pathname.replace('/api/automation','');
    const store=new AutomationStore(env.DB);
    if(request.method==='GET'&&path==='/events')return json({events:await store.events()});
    if(request.method==='GET'&&path==='')return json({policy:await store.policy(),usage:await store.usage(),screening:{configured:!!screeningEnv(env),model:screeningEnv(env)?.model||null},settings:await store.settings(),sources:await store.sources(),digests:await store.digests(),deliveries:await store.deliveries(),busy:await store.busy(Date.now()),services:{model:!!(env.LLM_API_KEY&&env.LLM_BASE_URL&&env.LLM_MODEL),...channelReady(env)},suggestedFeeds,runs:await store.runs(),stats:await store.collectionStats()});
    if(!['POST','PATCH','DELETE'].includes(request.method))throw new AutomationError('请求方法不支持。',405);
    if(request.headers.get('origin')!==url.origin)throw new AutomationError('请从同一地址的工作台操作。',403);
    if(await store.busy(Date.now()))throw new AutomationError('后台任务正在运行，稍后再修改设置或来源。',409);
    if(request.method==='POST'&&['/collect','/preview','/report','/run'].includes(path))return json(await runAutomation(env,path==='/collect'?'collect':path==='/preview'?'preview':path==='/report'?'report':'scheduled'));
    const encodedReportID=path.match(/^\/reports\/([^/]{1,320})\/send$/)?.[1];
    let reportID='';if(encodedReportID){try{reportID=decodeURIComponent(encodedReportID);}catch{throw new AutomationError('报告编号无效。');}if(!/^report:[a-zA-Z0-9:-]{1,100}$/.test(reportID))throw new AutomationError('报告编号无效。');}
    if(request.method==='POST'&&reportID)return json(await sendReport(env,reportID));
    if(!request.headers.get('content-type')?.includes('application/json'))throw new AutomationError('需要 JSON 正文。',415);
    const raw=await request.text();if(raw.length>8000)throw new AutomationError('设置内容过大。',413);
    let body:any;try{body=JSON.parse(raw);}catch{throw new AutomationError('设置不是有效 JSON。');}
    if(path==='/policy/parse'&&request.method==='POST')return json(await parseInstruction(body.instruction,env,meteredFetch(fetch,store,'policy')));
    if(path==='/policy'&&request.method==='PATCH'){
      const policy=validatePolicy(body),holder=await store.acquire(Date.now());if(!holder)throw new AutomationError('后台任务正在运行，请稍后保存要求。',409);
      try{await store.savePolicy(policy);return json({message:'搜集要求已保存，下次生成的新报告会采用这些要求。已生成的报告保持原样。'});}finally{await store.release(holder);}
    }
    const eventMatch=path.match(/^\/events\/([a-zA-Z0-9-]{1,80})\/(split|analyze)$/);
    if(eventMatch&&request.method==='POST') {
      const holder=await store.acquire(Date.now());if(!holder)throw new AutomationError('已有后台任务在运行。',409);
      try {
        const event=(await store.events()).find(e=>e.id===eventMatch[1]);if(!event)throw new AutomationError('事件不存在。',404);
        if(eventMatch[2]==='split') {
          const article=event.articles.find(a=>a.id===body.articleId);if(!article||event.articles.length<2)throw new AutomationError('请选择多文事件中的一篇文章。');
          const rest={...invalidateEvent(event,event.articles.filter(a=>a.id!==article.id)),groupingLocked:true,updatedAt:Date.now()};
          const solo={...invalidateEvent(event,[article]),id:crypto.randomUUID(),title:article.title,groupingLocked:true,updatedAt:Date.now()};
          await store.saveEvents([rest,solo]);return json({events:[rest,solo],message:'已修正分组并清除旧分析；后台不会自动重新合并这个分组。'});
        }
        const articles=event.articles.map(a=>({id:a.id,title:a.title,source:a.source,author:a.author,content:a.content}));
        const result=await analyzeArticles(articles,env,meteredFetch(fetch,store,'analysis'));
        const updated={...event,...result,pending:false,updatedAt:Date.now(),articles:event.articles.map(a=>({...a,...result.evaluations.find(e=>e.id===a.id)}))};
        await store.saveEvents([updated]);return json({event:updated,message:'后台事件已重新分析。'});
      }finally{await store.release(holder);}
    }
    if(path==='/settings'&&request.method==='PATCH'){await store.saveSettings(validateSettings(body));return json({message:'每日推送设置已保存。'});}
    if(path==='/sources'&&request.method==='POST'){
      if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>60||typeof body.url!=='string'||body.url.length>1500)throw new AutomationError('请填写来源名称和订阅地址。');
      const sources=await store.sources();if(sources.length>=10)throw new AutomationError('目前最多监听 10 个来源。');
      const address=feedURL(body.url,env.FEED_ALLOWED_HOSTS||'');if(sources.some(s=>s.url===address))throw new AutomationError('这个订阅地址已在列表中。');
      await store.addSource({id:crypto.randomUUID(),name:body.name.trim(),url:address,enabled:true});return json({message:'订阅源已添加。'});
    }
    const id=path.match(/^\/sources\/([a-zA-Z0-9-]{1,80})$/)?.[1];
    if(id){if(request.method==='DELETE'){await store.deleteSource(id);return json({message:'已停止监听并删除来源配置；已采集文章和历史事件仍保留。'});}if(request.method==='PATCH'&&typeof body?.enabled==='boolean'){await store.toggleSource(id,body.enabled);return json({message:'来源状态已更新。'});}}
    throw new AutomationError('接口不存在。',404);
  }catch(e){return json({message:(e instanceof AutomationError||e instanceof AnalysisError)?e.message:'后台操作失败。请确认数据库已迁移，再检查服务端日志和配置。'},(e instanceof AutomationError||e instanceof AnalysisError)?e.status:500);}
}

import { AutomationStore } from './store.ts';
import { feedURL } from './feeds.ts';
import { channelReady } from './delivery.ts';
import { runAutomation } from './runner.ts';
import { AutomationError, suggestedFeeds, validateSettings, type AutomationEnv } from './types.ts';
async function authorized(request:Request,token:string) {
  const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'')||'';
  const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const [a,b]=await Promise.all([digest(supplied),digest(token)]);let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;
}
export async function handleAutomation(request:Request,env:AutomationEnv) {
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
  try{
    if(!env.DB||!env.AUTOMATION_TOKEN||env.AUTOMATION_TOKEN.length<24)throw new AutomationError('自动订阅尚未配置。请先设置后台数据库和至少 24 位的管理口令。',503);
    if(!await authorized(request,env.AUTOMATION_TOKEN))throw new AutomationError('请输入正确的管理口令。',401);
    const url=new URL(request.url);const path=url.pathname.replace('/api/automation','');
    const store=new AutomationStore(env.DB);
    if(request.method==='GET'&&path==='')return json({settings:await store.settings(),sources:await store.sources(),digests:await store.digests(),deliveries:await store.deliveries(),busy:await store.busy(Date.now()),services:{model:!!(env.LLM_API_KEY&&env.LLM_BASE_URL&&env.LLM_MODEL),...channelReady(env)},suggestedFeeds});
    if(!['POST','PATCH','DELETE'].includes(request.method))throw new AutomationError('请求方法不支持。',405);
    if(request.headers.get('origin')!==url.origin)throw new AutomationError('请从同一地址的工作台操作。',403);
    if(await store.busy(Date.now()))throw new AutomationError('后台任务正在运行，稍后再修改设置或来源。',409);
    if(request.method==='POST'&&['/collect','/preview','/run'].includes(path))return json(await runAutomation(env,path==='/collect'?'collect':path==='/preview'?'preview':'scheduled'));
    if(!request.headers.get('content-type')?.includes('application/json'))throw new AutomationError('需要 JSON 正文。',415);
    const raw=await request.text();if(raw.length>8000)throw new AutomationError('设置内容过大。',413);
    let body:any;try{body=JSON.parse(raw);}catch{throw new AutomationError('设置不是有效 JSON。');}
    if(path==='/settings'&&request.method==='PATCH'){await store.saveSettings(validateSettings(body));return json({message:'每日推送设置已保存。'});}
    if(path==='/sources'&&request.method==='POST'){
      if(typeof body?.name!=='string'||!body.name.trim()||body.name.length>60||typeof body.url!=='string'||body.url.length>1500)throw new AutomationError('请填写来源名称和订阅地址。');
      const sources=await store.sources();if(sources.length>=10)throw new AutomationError('目前最多监听 10 个来源。');
      const address=feedURL(body.url,env.FEED_ALLOWED_HOSTS||'');if(sources.some(s=>s.url===address))throw new AutomationError('这个订阅地址已在列表中。');
      await store.addSource({id:crypto.randomUUID(),name:body.name.trim(),url:address,enabled:true});return json({message:'订阅源已添加。'});
    }
    const id=path.match(/^\/sources\/([a-zA-Z0-9-]{1,80})$/)?.[1];
    if(id){if(request.method==='DELETE'){await store.deleteSource(id);return json({message:'已删除来源及其采集文章；历史简报仍保留。'});}if(request.method==='PATCH'&&typeof body?.enabled==='boolean'){await store.toggleSource(id,body.enabled);return json({message:'来源状态已更新。'});}}
    throw new AutomationError('接口不存在。',404);
  }catch(e){return json({message:e instanceof AutomationError?e.message:'后台操作失败。请确认数据库已迁移，再检查服务端日志和配置。'},e instanceof AutomationError?e.status:500);}
}

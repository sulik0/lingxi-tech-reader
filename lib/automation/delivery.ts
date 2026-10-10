import { AutomationError, type AutomationEnv, type Channel, type Settings } from './types.ts';
import { readLimited } from './feeds.ts';
export class DeliveryError extends Error {uncertain:boolean;constructor(message:string,uncertain=false){super(message);this.uncertain=uncertain;}}
export function channelReady(env:AutomationEnv):Record<Channel,boolean> {return {email:!!(env.RESEND_API_KEY&&env.EMAIL_FROM),wecom:validWebhook(env.WECOM_WEBHOOK_URL,'wecom'),feishu:validWebhook(env.FEISHU_WEBHOOK_URL,'feishu')};}
function validWebhook(value:string|undefined,channel:Channel){try{webhook(value||'',channel);return true;}catch{return false;}}
function webhook(value:string,channel:Channel) {
  let u:URL;try{u=new URL(value);}catch{throw new AutomationError('机器人 Webhook 尚未配置。',503);}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port|| (channel==='wecom'?(u.hostname!=='qyapi.weixin.qq.com'||u.pathname!=='/cgi-bin/webhook/send'||!u.searchParams.get('key')):(u.hostname!=='open.feishu.cn'||!/^\/open-apis\/bot\/v2\/hook\/[^/]+$/.test(u.pathname)||!!u.search)))throw new AutomationError('机器人 Webhook 地址无效。',503);
  return u.href;
}
export function truncateBytes(text:string,max:number) {const encoder=new TextEncoder();let out='';for(const point of text){if(encoder.encode(out+point).length>max)break;out+=point;}return out;}
export function robotBrief(body:string) {
  const parts=body.split(/^## /m);
  if(parts.length===1)return body;
  const overview=parts[0].trim();
  const events=parts.slice(1).map(part=>{
    const lines=part.trim().split('\n');
    if(lines[0]==='只有短摘要，未作质量评分')return '只有短摘要的文章：请在完整简报查看链接。';
    const recommendationIndex=lines.findIndex(line=>line.startsWith('推荐阅读：'));
    const recommendation=lines[recommendationIndex];
    const reason=recommendationIndex>=0&&!lines[recommendationIndex+1]?.startsWith('原文：')?lines[recommendationIndex+1]:'';
    const url=lines.find(line=>line.startsWith('原文：'));
    const summary=lines[1]?.startsWith('综合资讯（多主题）')?lines.slice(1,3).join('\n'):lines[1]||'';
    return [lines[0],summary,recommendation||'',reason||'',url||''].filter(Boolean).join('\n');
  });
  return [overview,...events].join('\n\n');
}
export function deliveryPayload(channel:Channel,body:string,date:string,settings:Settings,env:AutomationEnv) {
  if(channel==='email')return {from:env.EMAIL_FROM,to:[settings.emailTo],subject:`灵析每日科技简报 · ${date}`,text:body};
  const max=channel==='wecom'?1900:15000;
  const brief=robotBrief(body);
  const suffix='\n\n（完整简报请在灵析“自动订阅与推送”中查看）';
  const shortened=brief!==body || new TextEncoder().encode(brief).length>max;
  const text=shortened?truncateBytes(brief,max-new TextEncoder().encode(suffix).length)+suffix:brief;
  return channel==='wecom'?{msgtype:'text',text:{content:text}}:{msg_type:'text',content:{text}};
}
export async function feishuSignature(timestamp:string,secret:string) {
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(timestamp+'\n'+secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,new Uint8Array()));
  return btoa(String.fromCharCode(...bytes));
}
export async function sendDelivery(channel:Channel,payload:Record<string,unknown>,key:string,env:AutomationEnv,fetcher:typeof fetch=fetch,now=Date.now()) {
  const endpoint=channel==='email'?'https://api.resend.com/emails':webhook(channel==='wecom'?env.WECOM_WEBHOOK_URL||'':env.FEISHU_WEBHOOK_URL||'',channel);
  if(channel==='email'&&!env.RESEND_API_KEY)throw new DeliveryError('邮件服务密钥未配置。');
  const headers:Record<string,string>={'Content-Type':'application/json'};
  if(channel==='email'){headers.Authorization=`Bearer ${env.RESEND_API_KEY}`;headers['Idempotency-Key']=key;}
  let data=payload;
  if(channel==='feishu'&&env.FEISHU_SIGNING_SECRET){const timestamp=String(Math.floor(now/1000));data={...payload,timestamp,sign:await feishuSignature(timestamp,env.FEISHU_SIGNING_SECRET)};}
  let response:Response;
  try{response=await fetcher(endpoint,{method:'POST',redirect:'manual',headers,body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});}catch{throw new DeliveryError('发送超时或连接中断，无法确认是否已送达。',true);}
  if(response.status>=300&&response.status<400)throw new DeliveryError(`发送服务返回 HTTP ${response.status} 重定向，未向新地址发送；请检查渠道配置。`,true);
  if(!response.ok)throw new DeliveryError(`发送服务返回 HTTP ${response.status}。`,response.status>=500);
  try{const result=JSON.parse(await readLimited(response,16000));if(channel==='email'){if(typeof result.id!=='string')throw new DeliveryError('邮件服务响应不完整，无法确认是否接收。',true);}else{const code=channel==='wecom'?result.errcode:result.code??result.StatusCode;if(code!==0)throw new DeliveryError('机器人拒绝了消息，请检查关键词、签名或机器人权限。');}}catch(e){if(e instanceof DeliveryError)throw e;throw new DeliveryError('发送响应无法解析，无法确认是否送达。',true);}
}

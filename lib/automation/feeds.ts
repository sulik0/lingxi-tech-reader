import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { AutomationError, type CollectedArticle, type FeedSource } from './types.ts';
export async function hash(value:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
export function feedURL(value:string,allowedHosts:string):string {
  let u:URL;
  try {u=new URL(value);} catch {throw new AutomationError('请输入有效的 HTTPS 订阅地址。');}
  const host=u.hostname.toLowerCase();
  const allowed=allowedHosts.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean);
  if(u.protocol!=='https:' || u.username || u.password || u.hash || (u.port && u.port!=='443') || !allowed.includes(host) || host==='localhost' || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.includes(':')) throw new AutomationError('订阅地址必须使用 HTTPS，且域名需要加入服务端 FEED_ALLOWED_HOSTS。');
  return u.href;
}
export function plainText(html:string) {
  const decoded=html.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n:string)=>{const point=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return point>0&&point<=0x10ffff?String.fromCodePoint(point):'';}).replace(/&(nbsp|amp|lt|gt|quot|apos);/g,(_,name:string)=>({nbsp:' ',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[name]||''));
  return decoded.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n\n').trim();
}

export function canonicalArticleURL(value:string) {
  const u=new URL(value);u.hash='';
  for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key)||['spm','from','ref','source','fbclid','gclid'].includes(key.toLowerCase()))u.searchParams.delete(key);
  u.searchParams.sort();return u.href;
}
function str(x:unknown):string {if(typeof x==='string'||typeof x==='number')return String(x);if(x&&typeof x==='object'&&'#text' in x)return str((x as Record<string,unknown>)['#text']);return '';}
function list<T>(x:T|T[]|undefined):T[] {return x===undefined?[]:Array.isArray(x)?x:[x];}
export async function parseFeed(raw:string,source:FeedSource,now:number):Promise<CollectedArticle[]> {
  if(raw.length>2000000 || /<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw)!==true) throw new AutomationError('订阅内容不是有效的 RSS/Atom，或大小超过限制。');
  const xml=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false}).parse(raw);
  const rss=xml.rss?.channel;
  const atom=xml.feed;
  if(!rss&&!atom)throw new AutomationError('这个地址没有返回 RSS 或 Atom 订阅内容。');
  const items=list<Record<string,unknown>>(rss?.item||atom?.entry).slice(0,50);
  const articles:CollectedArticle[]=[];
  for(const item of items) {
    const title=plainText(str(item.title)).slice(0,160);
    const links=list(item.link);
    let link=rss?str(item.link):str((links.find((l:any)=>!l['@_rel']||l['@_rel']==='alternate') as any)?.['@_href']);
    try {const u=new URL(link,source.url);link=['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?canonicalArticleURL(u.href):'';} catch {link='';}
    const content=plainText(str(item['content:encoded']||item.content||item.description||item.summary)).slice(0,16000);
    if(!title || !content || !link)continue;
    const date=Date.parse(str(item.pubDate||item.published||item.updated));
    const publishedAt=Number.isFinite(date)?date:now;
    if(publishedAt>now+3600000 || publishedAt<now-14*86400000)continue;
    const external=str(item.guid||item.id)||link;
    articles.push({id:await hash(source.id+'\n'+external),source:source.name,title,author:plainText(str(item['dc:creator']||(item.author as any)?.name||item.author))||'未提供',content,url:link,publishedAt,collectedAt:now,contentHash:await hash(content.replace(/\s+/g,''))});
  }
  return articles;
}
export async function readLimited(response:Response,max:number) {
  if(Number(response.headers.get('content-length')||0)>max)throw new AutomationError('订阅返回的内容过大。');
  if(!response.body)return '';
  const reader=response.body.getReader(); const chunks:Uint8Array[]=[];let size=0;
  try {while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>max)throw new AutomationError('订阅返回的内容过大。');chunks.push(value);}}finally{await reader.cancel();}
  const combined=new Uint8Array(size);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
  return new TextDecoder().decode(combined);
}
export async function fetchFeed(source:FeedSource,hosts:string,now:number,fetcher:typeof fetch=fetch) {
  const url=feedURL(source.url,hosts);
  let response:Response;
  // Workerd supports manual/follow only; inspect redirects before parsing.
  try {response=await fetcher(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Accept:'application/rss+xml, application/atom+xml, application/xml, text/xml','User-Agent':'LingxiReader/0.1'}});}catch(error){throw new AutomationError(`订阅读取失败：${transportError(error)}。请检查网络、证书和最终 HTTPS 地址。`);}
  if(response.status>=300&&response.status<400)throw new AutomationError(`订阅返回 HTTP ${response.status} 重定向；请将来源改为最终 HTTPS 地址并检查允许域名。`);
  if(!response.ok)throw new AutomationError(`订阅返回 HTTP ${response.status}。`);
  return parseFeed(await readLimited(response,2000000),source,now);
}
// Keep runtime diagnostics useful without retaining URLs or credentials in D1.
function transportError(error:unknown):string {
  if(!(error instanceof Error))return '网络请求异常';
  const name=['Error','TypeError','AbortError','TimeoutError'].includes(error.name)?error.name:'Error';
  const cause=error.cause instanceof Error?error.cause.message:'';
  const message=[error.message,cause].filter(Boolean).join(' / ')
    .replace(/https?:\/\/[^\s<>"']+/gi,'[地址已隐藏]')
    .replace(/\b(?:sk-|Bearer\s+)[\w.-]+/gi,'[凭据已隐藏]')
    .replace(/[A-Za-z0-9_-]{24,}/g,'[长标识已隐藏]')
    .replace(/[\r\n\t]/g,' ').slice(0,180);
  return `${name}${message?': '+message:''}`;
}

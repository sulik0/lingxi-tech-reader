import type {EventItem} from './data';
import {matchPolicy} from './automation/policy.ts';
import type {CollectionPolicy} from './automation/policy';
import type {Channel,Digest,FeedSource,Settings,ReportProgress} from './automation/types';

export type Snapshot={policy:CollectionPolicy;settings:Settings;sources:FeedSource[];digests:Digest[];deliveries:{digest_id:string;channel:Channel;status:string;error:string;attempts:number;started_at?:number}[];services:Record<Channel|'model',boolean>;busy:boolean;suggestedFeeds:{name:string;url:string}[];screening?:{configured:boolean;model:string|null};usage?:{stage:string;model:string;calls:number;promptTokens:number|null;completionTokens:number|null;unknownCalls:number}[]};
export type ReportActivity={busy:boolean;report:{id:string;date:string;status:string;createdAt:number;error:string;details?:{progress?:ReportProgress}}|null};
export type APIResult={message?:string;stage?:string;digestId?:string;failures?:string[];complete?:boolean;canContinue?:boolean;processed?:number};
export type ClientRequest=<T=APIResult>(path:string,method?:string,body?:unknown,signal?:AbortSignal)=>Promise<T>;
export type Bookmark={id:string;articles:string[]};
export const bookmarkKey='lingxi:feed-bookmarks:v1';
export const terms=(value:string)=>[...new Set(value.split(/[,，、;；\n]/).map(s=>s.trim()).filter(Boolean))];
export function publishedTime(e:EventItem){return Math.max(0,...e.articles.map(a=>typeof a.publishedAt==='number'&&Number.isFinite(a.publishedAt)&&a.publishedAt>0&&!Number.isNaN(new Date(a.publishedAt).getTime())?a.publishedAt:0));}
export function readable(e:EventItem){return !e.demo&&!e.pending&&!!e.summary.trim()&&e.articles.length>0;}
export function eventMatches(e:EventItem,p:CollectionPolicy){return e.articles.length>0&&e.articles.every(a=>matchPolicy(a,p).keep);}
export function visibleEvents(events:EventItem[],policy:CollectionPolicy){return events.filter(e=>readable(e)&&eventMatches(e,policy)).sort((a,b)=>publishedTime(b)-publishedTime(a)||a.id.localeCompare(b.id));}
export function safeLink(value?:string){try{const u=new URL(value||'');return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function topic(e:EventItem){return [e.tag,e.category].find(t=>t&&!['自动采集','科技资讯'].includes(t))||'科技资讯';}
export function isBookmarked(e:EventItem,entries:Bookmark[]){return entries.some(b=>b.id===e.id||e.articles.some(a=>b.articles.includes(a.id)));}
export function toggleBookmark(e:EventItem,entries:Bookmark[]){return isBookmarked(e,entries)?entries.filter(b=>b.id!==e.id&&!e.articles.some(a=>b.articles.includes(a.id))):[...entries,{id:e.id,articles:e.articles.map(a=>a.id)}];}
export function readBookmarks(raw:string|null):Bookmark[]{if(!raw)return [];const value:unknown=JSON.parse(raw);if(!Array.isArray(value)||value.length>2000||value.some(b=>!b||typeof b.id!=='string'||b.id.length>160||!Array.isArray(b.articles)||b.articles.length>50||b.articles.some((id:unknown)=>typeof id!=='string'||id.length>160)))throw Error('收藏记录无法读取，请检查当前浏览器的存储。');return value.map(b=>({id:b.id,articles:b.articles}));}
export function keywordChanges(before:string[],after:string[]){return {added:after.filter(s=>!before.includes(s)),removed:before.filter(s=>!after.includes(s)),kept:after.filter(s=>before.includes(s))};}
export function policyWithExclusions(policy:CollectionPolicy,words:string[]):CollectionPolicy{return {...policy,exclude:[...new Set([...policy.exclude,...words])]};}
export function formatTime(value:number){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'发布时间未知';}

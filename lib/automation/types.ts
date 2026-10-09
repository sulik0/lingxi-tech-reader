import type { AnalysisEnv } from '../analyze';
export type Channel = 'email' | 'wecom' | 'feishu';
export type AutomationEnv = AnalysisEnv & {
  DB?: D1Database;
  AUTOMATION_TOKEN?: string;
  FEED_ALLOWED_HOSTS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  WECOM_WEBHOOK_URL?: string;
  FEISHU_WEBHOOK_URL?: string;
  FEISHU_SIGNING_SECRET?: string;
};
export type FeedSource = {id:string;name:string;url:string;enabled:boolean;lastChecked?:number;lastSuccess?:number;error?:string};
export type Settings = {enabled:boolean;sendTime:string;emailTo:string;channels:Record<Channel,boolean>};
export const defaultSettings:Settings = {enabled:false,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:false}};
export const suggestedFeeds = [
  {name:'IT之家（网站 RSS）',url:'https://www.ithome.com/rss/'},
  {name:'极客公园（网站 RSS）',url:'https://www.geekpark.net/rss'},
  {name:'宝玉的分享（博客 RSS）',url:'https://s.baoyu.io/feed.xml'},
];
export type CollectedArticle = {id:string;source:string;title:string;author:string;content:string;url:string;publishedAt:number;collectedAt:number;contentHash:string};
export type Digest = {id:string;date:string;status:string;body:string;error:string;createdAt:number;preview:boolean};
export class AutomationError extends Error {
  status:number;
  constructor(message:string,status=400){super(message);this.status=status;}
}
export function validateSettings(value:unknown):Settings {
  const x=value as Settings;
  if(!x || typeof x.enabled!=='boolean' || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(x.sendTime) || typeof x.emailTo!=='string' || x.emailTo.length>254 || !x.channels || ['email','wecom','feishu'].some(c=>typeof x.channels[c as Channel]!=='boolean')) throw new AutomationError('请填写有效的发送时间和渠道设置；时间按北京时间，每 15 分钟可选一次。');
  if(x.channels.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.emailTo)) throw new AutomationError('启用邮件前，请填写收件邮箱。');
  if(x.enabled && !Object.values(x.channels).some(Boolean)) throw new AutomationError('启用每日推送前，请至少选择一个发送渠道。');
  return {enabled:x.enabled,sendTime:x.sendTime,emailTo:x.emailTo.trim(),channels:{email:x.channels.email,wecom:x.channels.wecom,feishu:x.channels.feishu}};
}
export function beijingSchedule(now:number,time:string) {
  const shifted=new Date(now+8*3600000);
  const date=shifted.toISOString().slice(0,10);
  const [h,m]=time.split(':').map(Number);
  const cutoff=Date.parse(`${date}T00:00:00+08:00`)+(h*60+m)*60000;
  return {date,cutoff,due:now>=cutoff,start:cutoff-86400000};
}

import type {Digest,Channel} from './types.ts';
export const channelNames:Record<Channel,string>={email:'邮件',wecom:'企业微信',feishu:'飞书'};
export const deliveryNames:Record<string,string>={pending:'等待发送',sending:'正在发送',sent:'已发送',error:'发送失败',uncertain:'无法确认送达'};
export function digestLabel(d:Digest) {
  if(d.details?.legacyEmpty)return '旧记录 · 无内容';
  if(d.details?.progress?.stage==='failed')return d.body?'部分完成 · 分析受阻':'分析受阻';
  if(d.status==='ready'&&d.details?.progress?.stage==='complete')return '已完成';
  if(d.status==='waiting'||(d.status==='error'&&d.error.startsWith('还有文章等待成功分析')))return '等待分析';
  if(d.status==='empty')return '暂无新内容';
  if(d.status==='ready')return d.details?.pendingCount?'部分完成':'已生成';
  return d.status==='error'?'生成失败':'正在生成';
}
export function selectHistory(digests:Digest[],preview:boolean,selected='') {
  const list=digests.filter(d=>d.preview===preview);
  return list.find(d=>d.id===selected)||list[0];
}

export function selectReport(digests:Digest[],selected='') {
  return digests.find(d=>d.id===selected)||digests.find(d=>d.status==='ready'&&!!d.body&&!d.details?.legacyEmpty)||digests[0];
}

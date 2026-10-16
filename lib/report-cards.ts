export type ReportSource={href:string;title:string;host:string;recommended:boolean};
export type ReportCard={title:string;summary:string[];details:string[];sources:ReportSource[]};
function source(value:string,title:string,recommended:boolean):ReportSource|null{
 try{const u=new URL(value.trim());if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;return {href:u.href,title,host:u.hostname.replace(/^www\./,''),recommended};}catch{return null;}
}
/** Read saved reports without changing their text or requesting another model analysis. */
export function reportCards(body:string):ReportCard[]{
 return body.replace(/\r\n?/g,'\n').split(/^## /m).slice(1).flatMap(part=>{
  const [heading,...lines]=part.trim().split('\n'),title=heading.trim();if(!title)return [];
  const boundary=lines.findIndex(l=>/^(事实与依据|作者观点|文章提供的新信息|推荐阅读|原文|参考|阅读建议|尚不确定)：/.test(l));
  const summary=lines.slice(0,boundary<0?lines.length:boundary).filter(l=>l.trim());
  const recommendation=lines.findIndex(l=>l.startsWith('推荐阅读：'));
  const candidates=lines.flatMap(l=>{if(l.startsWith('原文：')){const s=source(l.slice(3),recommendation>=0?lines[recommendation].slice(5):'原文',recommendation>=0);return s?[s]:[];}if(l.startsWith('参考：')){const i=l.lastIndexOf('｜');const s=i>=0?source(l.slice(i+1),l.slice(3,i),false):null;return s?[s]:[];}return [];});
  const sources=candidates.filter((s,i)=>candidates.findIndex(a=>a.href===s.href)===i);
  // Article assessments and recommendation reasons stay in the saved report, not in the feed.
  let inAssessment=false;
  const details=lines.slice(boundary<0?lines.length:boundary).filter((line,i)=>{
   const l=line.trim();if(l.startsWith('文章提供的新信息：'))inAssessment=true;
   if(/^(推荐阅读|阅读建议|尚不确定)：/.test(l))inAssessment=false;
   return !!l&&!inAssessment&&!/^(推荐阅读|原文|参考|阅读建议)：/.test(l)&&!(recommendation>=0&&boundary+i===recommendation+1)&&!/^生成时有 \d+ 篇文章尚未完成分析/.test(l);
  });
  return summary.length?[{title,summary,details,sources}]:[];
 });
}

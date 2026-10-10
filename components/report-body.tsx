'use client';
import {ArrowUpRight} from 'lucide-react';
function link(value:string){try{const u=new URL(value);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)return u.href;}catch{}return null;}
export default function ReportBody({body}:{body:string}){
  const [intro,...parts]=body.split(/^## /m);
  const lineView=(line:string,key:number)=><p key={key} className={line.trimStart().startsWith('原句：')?'brief-quote':''}>{line.replace(/^- /,'• ')}</p>;
  return <div className="brief-document"><p className="brief-basis">{intro.split('\n').find(s=>s.startsWith('依据'))||'依据来源正文整理，尚未独立核实。'}</p>{parts.map((part,index)=>{
    const [title,...lines]=part.trim().split('\n');const facts=lines.indexOf('事实与依据：');const recommendation=lines.findIndex(l=>l.startsWith('推荐阅读：'));
    const summary=lines.slice(0,facts>=0?facts:lines.length).filter(l=>l.trim()&&!l.startsWith('原文：')&&!l.startsWith('参考：'));
    const reason=recommendation>=0&&!lines[recommendation+1]?.startsWith('原文：')?lines[recommendation+1]:'';
    const sources=lines.flatMap(l=>{if(l.startsWith('原文：')){const href=link(l.slice(3));return href?[{href,title:'推荐原文'}]:[];}if(l.startsWith('参考：')){const i=l.lastIndexOf('｜'),href=link(l.slice(i+1));return i>=0&&href?[{href,title:l.slice(3,i)}]:[];}return [];}).filter((s,i,all)=>all.findIndex(a=>a.href===s.href)===i);
    const detail=facts>=0?lines.slice(facts).filter((l,i)=>l.trim()&&!l.startsWith('原文：')&&!l.startsWith('参考：')&&!l.startsWith('推荐阅读：')&&!/^(?:生成时)?有 \d+ 篇文章尚未完成分析/.test(l)&&!(recommendation>=0&&facts+i===recommendation+1)):[];
    return <section className="brief-event" key={index}><h3>{index+1}. {title}</h3>{summary.map(lineView)}{reason&&<p className="brief-recommendation">需要深入了解时：{reason}</p>}{sources.length>0&&<div className="report-reference-links" aria-label="报告原文链接">{sources.map((s,i)=><a key={s.href} href={s.href} title={s.title} target="_blank" rel="noopener noreferrer">{i===0?'阅读推荐原文':`参考来源 ${i+1}`}<ArrowUpRight size={13}/></a>)}</div>}{detail.length>0&&<details className="brief-analysis"><summary>展开事实、观点与分析依据</summary>{detail.map(lineView)}</details>}</section>;
  })}</div>;
}

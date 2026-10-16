'use client';
import {useMemo} from 'react';
import {ArrowUpRight} from 'lucide-react';
import {reportCards} from '../lib/report-cards';
export default function ReportBody({body}:{body:string}){
 const cards=useMemo(()=>reportCards(body),[body]);
 return <div className="report-stream" aria-label="精选科技资讯">{cards.length?cards.map((card,index)=><article className="news-card" key={index} aria-labelledby={'news-title-'+index}>
  {card.sources.length>0&&<div className="news-card-sources">{[...new Set(card.sources.map(s=>s.host))].map(host=><span key={host}>{host}</span>)}</div>}
  <h3 id={'news-title-'+index}>{card.title}</h3>
  <div className="news-card-summary">{card.summary.map((line,i)=><p key={i}>{line.replace(/^- /,'• ')}</p>)}</div>
  {card.sources.length>0&&<div className="news-card-links">{card.sources.map((s,i)=><a href={s.href} key={s.href} target="_blank" rel="noopener noreferrer" title={s.title} aria-label={(s.recommended?'推荐原文：':'原文：')+s.title}>{s.recommended?'阅读原文':i===0?'原文链接':'更多来源'}<ArrowUpRight size={14} aria-hidden="true"/></a>)}</div>}
  {card.details.length>0&&<details className="news-card-details"><summary>事实与观点</summary>{card.details.map((line,i)=><p key={i}>{line.replace(/^- /,'• ')}</p>)}</details>}
 </article>):<p className="feed-help">这份报告暂无可展示的资讯，请重新检索。</p>}</div>;
}

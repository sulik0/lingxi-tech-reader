'use client';
import {useState} from 'react';
import {Bookmark,ArrowUpRight} from 'lucide-react';
import type {EventItem} from '../lib/data';
import {safeLink,topic,publishedTime,formatTime} from '../lib/client-feed';

export default function FeedItem({event,saved,onBookmark,onReduce,locked}:{event:EventItem;saved:boolean;onBookmark:()=>void;onReduce:()=>void;locked:boolean}){
  const [expanded,setExpanded]=useState(false);
  const sources=[...new Set(event.articles.map(a=>a.source))];
  const recommended=event.articles.find(a=>a.id===event.recommendedArticleId&&safeLink(a.url));
  const primary=recommended||event.articles.find(a=>safeLink(a.url));
  return <article className="feed-item" aria-labelledby={'title-'+event.id}><div className="feed-item-heading"><h2 id={'title-'+event.id}>{event.title}</h2><button className="feed-icon" aria-label={(saved?'取消收藏：':'收藏：')+event.title} aria-pressed={saved} onClick={onBookmark}><Bookmark aria-hidden="true" size={19} fill={saved?'currentColor':'none'}/></button></div><div className="feed-meta"><span>{sources.slice(0,2).join('、')}{sources.length>2?`，另 ${sources.length-2} 个来源`:''} <span className="article-count">综合 {event.articles.length} 篇</span></span><time dateTime={publishedTime(event)?new Date(publishedTime(event)).toISOString():undefined}>{formatTime(publishedTime(event))}</time></div>
    <p className={expanded?'feed-summary':'feed-summary clamped'}>{event.summary}</p>{event.summary.length>50&&<button className="feed-text summary-toggle" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?'收起摘要':'展开摘要'}</button>}
    <div className="feed-item-bottom"><div className="feed-links"><span className="feed-tag">{event.articleKind==='roundup'?'多主题汇总':topic(event)}</span>{primary&&<a href={safeLink(primary.url)!} target="_blank" rel="noopener noreferrer">{recommended?'推荐原文':'来源原文'}<ArrowUpRight aria-hidden="true" size={14}/></a>}</div><button className="feed-text" disabled={locked} onClick={onReduce}>减少类似内容</button></div>
    <details className="feed-details"><summary>查看来源与分析依据</summary><div className="feed-detail-body"><div className="source-links">{event.articles.map(a=>safeLink(a.url)?<a key={a.id} href={safeLink(a.url)!} target="_blank" rel="noopener noreferrer">{a.source}：{a.title}<ArrowUpRight aria-hidden="true" size={13}/></a>:<p key={a.id}>{a.source}：{a.title}（暂无有效链接）</p>)}</div>{event.facts.length>0&&<><h3>事实与依据</h3>{event.facts.map((f,i)=><div key={i}><p>{f.text} <span className="feed-help">{f.status==='来源一致'?'多个来源提及，尚未独立核实':'待核实'}</span></p><blockquote>{f.evidence}</blockquote></div>)}</>}{event.opinions.length>0&&<><h3>作者观点</h3>{event.opinions.map((o,i)=><p key={i}>{o.source}：{o.view}<small>{o.basis}</small></p>)}</>}<h3>阅读建议</h3><p>{event.conclusion}</p>{recommended?.reason&&<p>推荐理由：{recommended.reason}</p>}<p className="feed-help">{event.uncertainty}</p></div></details>
  </article>;
}

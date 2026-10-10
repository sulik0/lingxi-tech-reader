import type {EventItem} from '../data.ts';
import type {CollectedArticle} from './types.ts';
// Include only completed analyses (or explicitly unscored short summaries).
export function selectDigestEvents(articles:CollectedArticle[],events:EventItem[],limit=24) {
  const ids=new Set(articles.map(a=>a.id)),seen=new Set<string>();const selected:EventItem[]=[];
  const complete=events.filter(e=>!e.pending||e.articles.every(a=>a.content.length<80));
  const covered=new Set(complete.flatMap(e=>e.articles.map(a=>a.id)));
  for(const a of articles){const event=complete.find(e=>e.articles.some(b=>b.id===a.id));if(!event||seen.has(event.id))continue;
    const count=event.articles.filter(b=>ids.has(b.id)).length;
    if(selected.reduce((n,e)=>n+e.articles.filter(b=>ids.has(b.id)).length,0)+count>limit)continue;
    seen.add(event.id);selected.push(event);
  }
  const included=new Set(selected.flatMap(e=>e.articles.map(a=>a.id)));
  return {events:selected,articleIds:[...included],articleCount:articles.filter(a=>included.has(a.id)).length,pendingCount:articles.filter(a=>a.content.length>=80&&!covered.has(a.id)).length};
}

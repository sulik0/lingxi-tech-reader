import type {Article, EventItem} from './data.ts';
export function invalidateEvent(event:EventItem,articles:Article[]):EventItem {
  return {...event,recommendedArticleId:undefined,articles:articles.map(({score,metrics,hype,duplicate,reason,extra,flags,...a})=>a),facts:[],opinions:[],points:[],pending:true,summary:'文章分组已调整，等待重新分析。',conclusion:'当前分组尚未分析，暂时没有推荐文章。',uncertainty:'旧分析已清除，需要根据当前完整分组重新分析。'};
}
export function beijingDate(timestamp:number) {return new Date(timestamp+8*3600000).toISOString().slice(0,10);}

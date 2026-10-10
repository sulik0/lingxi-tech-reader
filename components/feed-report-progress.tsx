import type {ReportProgress} from '../lib/automation/types';
import {formatTime} from '../lib/client-feed';
export default function FeedReportProgress({progress,limited=false}:{progress:ReportProgress;limited?:boolean}){
 const done=progress.completed+progress.filtered;
 const interrupted=['screening','analyzing','rendering'].includes(progress.stage)&&Date.now()-progress.updatedAt>12*60000;
 const names={screening:'初筛与事件分组',analyzing:'分析事件',rendering:'汇总报告',paused:'本批结束，等待继续',failed:'分析受阻',complete:'处理完成'};
 return <section className="feed-report-progress" aria-label="报告分析进度"><p role="status"><strong>{interrupted?'进度已超过 12 分钟未更新':names[progress.stage]}</strong> · {interrupted?'任务可能已中断。先确认后台已结束，再继续这份报告，已完成内容会保留。':progress.message}</p>{progress.total>0&&<><progress aria-label="本次资讯处理进度" max={progress.total} value={done}/><p>本次 {progress.total} 篇：已纳入 {progress.completed} 篇，已排除 {progress.filtered} 篇，待处理 {progress.pending} 篇。</p></>}{progress.stage==='analyzing'&&!interrupted&&<p>本批已处理 {progress.batchCompleted} / {progress.batchTotal} 个事件；通过校验后才纳入报告。</p>}<small>第 {progress.rounds} 批 · 更新于 {formatTime(progress.updatedAt)}。范围在创建时固定为最近 24 小时的资讯。</small>{limited&&<p className="feed-help">最近 24 小时超过 240 篇，本次只处理最新的 240 篇。</p>}{progress.failures.length>0&&<div className="feed-error" role="alert"><p>{progress.failures[0]}</p>{progress.failures.length>1&&<details><summary>其他 {progress.failures.length-1} 个问题</summary>{progress.failures.slice(1).map((f,i)=><p key={i}>{f}</p>)}</details>}<p>已完成结果会保留，不会自动无限重试。可在修复服务后继续这份报告。</p></div>}</section>;
}

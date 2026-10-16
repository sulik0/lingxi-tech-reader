'use client';
import {useEffect,useState} from 'react';
import type {Channel,Digest} from '../lib/automation/types';
import {channelNames,deliveryNames} from '../lib/automation/presentation';
import {formatTime,canSendReport,type Snapshot,type ClientRequest,type ReportActivity} from '../lib/client-feed';
import ReportBody from './report-body';
import FeedReportProgress from './feed-report-progress';
const channels:Channel[]=['feishu','wecom','email'];
export default function FeedReport({data,report,locked,reporting,activity,notice,noticeError,generate,request,refresh,run,openSettings}:{data:Snapshot;report?:Digest;locked:boolean;reporting:boolean;activity:ReportActivity|null;notice:string;noticeError:boolean;generate:(id?:string)=>Promise<void>;request:ClientRequest;refresh:()=>Promise<unknown>;run:<T>(task:()=>Promise<T>)=>Promise<T>;openSettings:()=>void}){
 const [sendOpen,setSendOpen]=useState(false),[selected,setSelected]=useState<Channel[]>([]),[sending,setSending]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
 useEffect(()=>{setSendOpen(false);setSelected([]);setMessage('');},[report?.id]);
 const rows=data.deliveries.filter(d=>d.digest_id===report?.id),progress=reporting?activity?.report?.details?.progress:report?.details?.progress;
 const ready=report?.status==='ready'&&!!report.body,partial=!!report?.details?.pendingCount;
 const resumable=!!report?.details?.scope&&partial&&Date.now()-report.createdAt<23*3600000&&!rows.some(d=>['sent','sending','uncertain'].includes(d.status));
 const samePolicy=JSON.stringify(report?.details?.policy?.include||[])===JSON.stringify(data.policy.include)&&JSON.stringify(report?.details?.policy?.exclude||[])===JSON.stringify(data.policy.exclude);
 const sendable=channels.filter(c=>canSendReport(report,c,data));
 const send=async()=>{if(!report||!selected.length)return;setSending(true);setMessage('');setError(false);try{await run(async()=>{const r=await request('/reports/'+encodeURIComponent(report.id)+'/send','POST',{channels:selected});await refresh();setError(r.stage!=='sent');setMessage(r.message||'请检查发送结果。');setSelected([]);});}catch(e){setError(true);setMessage(e instanceof Error?e.message:'发送失败，请检查渠道状态。');await refresh();}finally{setSending(false);}};
 return <section className="home-report" aria-labelledby="home-report-title"><div className="home-report-heading"><div><h1 id="home-report-title">值得看的科技新鲜事</h1><p className="feed-help">按你的偏好筛选，合并重复报道。</p></div><button className="feed-primary home-generate" disabled={locked||!data.services.model||!data.sources.some(s=>s.enabled)} onClick={()=>void generate()}>{reporting?'正在生成报告…':data.busy?'后台正在处理…':'检索并生成报告'}</button></div>
 {!data.services.model&&<p className="feed-error">分析服务未配置，请在设置中检查。</p>}{!data.sources.some(s=>s.enabled)&&<p className="feed-help">先在设置中添加并启用订阅来源。<button className="feed-text" onClick={openSettings}>打开设置</button></p>}
 <div className="home-report-status" aria-live="polite">{notice?<p className={noticeError?'feed-error':'feed-notice'} role={noticeError?'alert':'status'}>{notice}</p>:<p className="feed-help">{reporting?'正在整理资讯，请稍候…':ready?'已有报告，可以直接阅读。':'还没有报告，点击上方按钮开始。'}</p>}</div>
 {progress&&reporting&&<FeedReportProgress progress={progress}/>}
 {!reporting&&partial&&<p className="feed-help" role="status">报告已包含成功整理的内容，还有部分资讯未完成。{resumable&&samePolicy?<button className="feed-text" disabled={locked} onClick={()=>void generate(report!.id)}>重试未完成的资讯</button>:'重新检索可继续整理。'}</p>}
 {!reporting&&(report?.error||progress?.stage==='failed')&&<p className="feed-error" role="alert">{report?.error||progress?.failures[0]||'部分资讯分析失败，请重试。'}</p>}
 {ready&&!samePolicy&&<p className="feed-help">偏好已调整，当前报告仍使用生成时的要求。再次检索后会按新偏好整理。</p>}
 {ready&&<div className="home-report-result"><div className="home-result-toolbar"><h2>精选资讯</h2><span className="feed-help">报告更新于 {formatTime(report.createdAt)}</span><button className="feed-secondary" disabled={locked||!report.details?.manual} aria-expanded={sendOpen} aria-controls="report-send-options" onClick={()=>setSendOpen(v=>!v)}>选择发送渠道</button></div>
 {sendOpen&&<div className="home-send" id="report-send-options"><fieldset disabled={locked}><legend>把这份报告发送到</legend>{channels.map(channel=>{const row=rows.find(r=>r.channel===channel),available=sendable.includes(channel);return <label className="feed-check" key={channel}><input type="checkbox" name="reportChannels" value={channel} checked={selected.includes(channel)} disabled={!available} onChange={e=>setSelected(s=>e.target.checked?[...s,channel]:s.filter(c=>c!==channel))}/>{channelNames[channel]}<span className="feed-help">{row?deliveryNames[row.status]||'状态未知':!data.services[channel]?'未配置':channel==='email'&&!data.settings.emailTo?'请先设置收件邮箱':Date.now()-report.createdAt>=23*3600000?'报告已过期':available?'尚未发送':'请检查渠道状态'}</span></label>;})}</fieldset>
 {rows.some(r=>r.status==='uncertain')&&<p className="feed-help">部分渠道无法确认送达，请先检查消息；不会重复发送。</p>}{rows.filter(r=>r.error).map(r=><p className="feed-error" key={r.channel}>{channelNames[r.channel]}：{r.error}</p>)}
 {!sendable.length&&<p className="feed-help">没有可发送的渠道；请检查配置、发送状态或重新生成报告。</p>}<div className="home-send-actions"><button className="feed-primary" disabled={locked||sending||!selected.length} onClick={()=>void send()}>{sending?'正在发送…':'发送到所选渠道'}</button><button className="feed-text" onClick={openSettings}>配置渠道</button></div><p className="feed-help">只发送当前报告，不改变每日自动推送设置。</p></div>}
 {message&&<p role={error?'alert':'status'} className={error?'feed-error':'feed-notice'}>{message}</p>}
 <ReportBody body={report.body}/></div>}
 {!ready&&!reporting&&<div className="home-report-empty"><p>{report?.status==='empty'?'没有符合当前偏好的可用资讯。':report?.status==='waiting'?'暂时没有完成的报告，原文已保留，可以重新整理。':'生成后，摘要、分析和原文链接会显示在这里。'}</p></div>}
 </section>;
}

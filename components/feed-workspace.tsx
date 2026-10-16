'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {Settings2} from 'lucide-react';
import type {CollectionPolicy} from '../lib/automation/policy';
import {validatePolicy} from '../lib/automation/policy';
import {latestReport,reportContentKey,type APIResult,type Snapshot,type ReportActivity} from '../lib/client-feed';
import FeedPreferences from './feed-preferences';
import FeedDialog from './feed-dialog';
import FeedSettings from './feed-settings';
import FeedReport from './feed-report';

export default function FeedWorkspace(){
 const token=useRef(''),controller=useRef<AbortController|null>(null),workflow=useRef<AbortController|null>(null),revision=useRef(0),busyRef=useRef(false),returnFocus=useRef<HTMLElement|null>(null),reportTarget=useRef(''),reportStarted=useRef(0),lastContent=useRef('');
 const [connected,setConnected]=useState(false),[credential,setCredential]=useState(''),[data,setData]=useState<Snapshot|null>(null);
 const [busy,setBusy]=useState(false),[reading,setReading]=useState(false),[readError,setReadError]=useState(''),[notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false),[settingsOpen,setSettingsOpen]=useState(false);
 const [reporting,setReporting]=useState(false),[reportActivity,setReportActivity]=useState<ReportActivity|null>(null),[selected,setSelected]=useState('');
 const api=useCallback(async<T=APIResult>(path:string,method='GET',body?:unknown,signal?:AbortSignal,credentialOverride?:string):Promise<T>=>{
  const timeout=AbortSignal.timeout(path==='/report'?360000:path==='/collect'?120000:30000);let response:Response;
  try{response=await fetch('/api/automation'+path,{method,signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{Authorization:'Bearer '+(credentialOverride??token.current),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch(e){if(e instanceof Error&&e.name==='TimeoutError')throw Error('等待响应超时。请刷新查看处理结果；发送超时后请先检查是否收到消息。');throw e;}
  let result:T&{message?:string};try{result=await response.json();}catch{throw Error(`无法读取结果（HTTP ${response.status}），请重试。`);}if(!response.ok)throw Error(result.message||`请求失败（HTTP ${response.status}）。`);return result;
 },[]);
 const refresh=useCallback(async(credentialOverride?:string)=>{
  const id=++revision.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setReading(true);setReadError('');
  try{const value=await api<Snapshot>('','GET',undefined,abort.signal,credentialOverride);if(id===revision.current){setData(value);const content=reportContentKey(latestReport(value.digests));if(content){if(token.current&&lastContent.current&&content!==lastContent.current){setNotice('有新报告，可以直接阅读。');setNoticeError(false);}lastContent.current=content;}if(credentialOverride){token.current=credentialOverride;setConnected(true);setCredential('');}}return value;}catch(e){if(id===revision.current)setReadError('报告暂时无法读取：'+errorText(e)+' 已有内容仍保留。');}finally{if(id===revision.current)setReading(false);}
 },[api]);
 useEffect(()=>()=>{revision.current++;controller.current?.abort();workflow.current?.abort();},[]);
 useEffect(()=>{if(!connected)return;const timer=setInterval(()=>{if(!busyRef.current)void refresh();},60000);return()=>clearInterval(timer);},[connected,refresh]);
 useEffect(()=>{if(!connected||!reporting&&!data?.busy)return;const abort=new AbortController();let timer:ReturnType<typeof setTimeout>;const poll=async()=>{try{const result=await api<ReportActivity>('/progress'+(reportTarget.current?'?reportId='+encodeURIComponent(reportTarget.current):''),'GET',undefined,abort.signal);if(!abort.signal.aborted){if(!reporting||result.report?.id===reportTarget.current||!reportTarget.current&&result.report&&result.report.createdAt>=reportStarted.current)setReportActivity(result);if(!reporting&&!result.busy)await refresh();}}catch{if(!abort.signal.aborted)setNotice('进度暂时无法读取，后台可能仍在处理，请勿重复点击。');}finally{if(!abort.signal.aborted)timer=setTimeout(poll,3000);}};void poll();return()=>{abort.abort();clearTimeout(timer);};},[connected,reporting,data?.busy,api,refresh]);
 const run=async<T,>(task:()=>Promise<T>):Promise<T>=>{if(busyRef.current)throw Error('正在处理上一次操作，请稍候。');busyRef.current=true;setBusy(true);try{return await task();}finally{busyRef.current=false;setBusy(false);}};
 const savePolicy=async(policy:CollectionPolicy)=>run(async()=>{const fresh=await api<Snapshot>('');if(data&&JSON.stringify(fresh.policy)!==JSON.stringify(data.policy)){setData(fresh);throw Error('偏好已在其他地方变更，请重新检查后保存。');}const p=validatePolicy(policy);await api('/policy','PATCH',p);setData(d=>d?{...d,policy:p}:d);await refresh();});
 const current=(reporting?data?.digests.find(d=>d.id===selected):undefined)||latestReport(data?.digests||[]);
 const generate=async(reportId?:string)=>run(async()=>{
  const abort=new AbortController();workflow.current=abort;reportTarget.current=reportId||'';reportStarted.current=Date.now();setReporting(true);setReportActivity(null);setNoticeError(false);const previous=reportContentKey(current);
  try{
   let collection:APIResult={};if(!reportId){setNotice('正在检索订阅来源…');collection=await api('/collect','POST',undefined,abort.signal);if(collection.stage==='busy')throw Error('后台正在处理，请稍候。');}
   let report:APIResult={},id=reportId,processed=-1;
   while(!abort.signal.aborted){
    setNotice('正在去重并整理报告…');report=await api('/report','POST',id?{reportId:id}:{},abort.signal);if(report.stage==='busy')throw Error('后台正在处理，请稍候。');id=report.digestId;if(!id)throw Error('没有取得报告结果，请刷新查看。');reportTarget.current=id;setSelected(id);
    const activity=await api<ReportActivity>('/progress?reportId='+encodeURIComponent(id),'GET',undefined,abort.signal);setReportActivity(activity);
    if(report.complete||!report.canContinue)break;
    if((report.processed??0)<=processed)throw Error('处理进度暂时没有推进。已整理的内容保留，请稍后重试。');processed=report.processed??0;
   }
   if(abort.signal.aborted)return;
   const fresh=await refresh();if(!fresh){setNoticeError(true);setNotice('整理已结束，但暂时无法读取报告。请刷新页面查看。');return;}const result=fresh.digests.find(d=>d.id===id);
   const failed=!!report.failures?.length||!!collection.failures?.length;
   setNoticeError(failed);
   setNotice(failed?(report.failures?.[0]||'部分订阅来源读取失败，报告可能不完整。'):result?.body?(previous===reportContentKey(result)?'暂无新报告，内容与上次相同。':'新报告已生成。你可以直接阅读，也可以选择发送渠道。'):'暂无新报告，没有符合当前偏好的可用资讯。');
  }catch(e){if(!abort.signal.aborted){setNotice(errorText(e));setNoticeError(true);await refresh();}}finally{if(!abort.signal.aborted)setReporting(false);workflow.current=null;}
 });
 const disconnect=()=>{revision.current++;controller.current?.abort();workflow.current?.abort();token.current='';setConnected(false);setData(null);setCredential('');setSettingsOpen(false);setReadError('');setNotice('');setSelected('');setReportActivity(null);reportTarget.current='';lastContent.current='';setReporting(false);};
 const openSettings=()=>{returnFocus.current=document.activeElement as HTMLElement;setSettingsOpen(true);};
 const locked=busy||!!data?.busy;
 return <div className="feed-workspace"><a className="skip-link" href="#feed-main">跳到报告</a><header className="feed-header"><a href="/" className="feed-brand" aria-label="灵析首页">灵析<span>个人科技信息流</span></a><button className="feed-text" onClick={openSettings}><Settings2 size={16} aria-hidden="true"/>设置</button></header><main id="feed-main" className="feed-main">
 {!connected?<section className="feed-connect"><h1>连接你的科技报告</h1><p className="feed-help">连接后，一键检索科技资讯并生成报告。管理口令只保存在本次页面内存中。</p><form onSubmit={e=>{e.preventDefault();if(credential&&!reading)void refresh(credential);}}><label htmlFor="feed-credential">管理口令</label><div className="connect-actions"><input id="feed-credential" name="credential" type="password" spellCheck={false} autoComplete="off" value={credential} disabled={reading} onChange={e=>setCredential(e.target.value)}/><button className="feed-primary" disabled={reading||!credential}>{reading?'正在连接…':'连接'}</button></div></form></section>:data&&<>
 <FeedReport data={data} report={current} locked={locked} reporting={reporting||!!data.busy&&reportActivity?.report?.status==='generating'} activity={reportActivity} notice={notice} noticeError={noticeError} generate={generate} request={api} refresh={refresh} run={run} openSettings={openSettings}/>
 <details className="home-preferences"><summary>调整信息偏好<span>{data.policy.include.length?'关注 '+data.policy.include.join('、'):'不限主题'}{data.policy.exclude.length?'；不看 '+data.policy.exclude.join('、'):''}</span></summary><FeedPreferences policy={data.policy} locked={locked} request={api} save={savePolicy}/></details>
 </>}
 {readError&&<div className="feed-error" role="alert"><p>{readError}</p>{connected&&<button className="feed-text" disabled={reading||busy} onClick={()=>void refresh()}>重新读取报告</button>}</div>}
 </main><footer className="feed-footer">依据来源正文整理，尚未独立核实。需要深入了解时，再打开报告中的原文链接。</footer>
 <FeedDialog open={settingsOpen} onOpenChange={setSettingsOpen} returnFocus={returnFocus} title="设置" description="维护订阅来源、发送渠道和每日自动推送。">{data&&settingsOpen?<FeedSettings data={data} locked={locked} request={api} refresh={refresh} savePolicy={savePolicy} disconnect={disconnect}/>:<p className="feed-help">请先关闭设置，在首页输入管理口令连接。</p>}</FeedDialog>
 </div>;
}
function errorText(e:unknown){return e instanceof Error?e.message:'操作暂时未完成，请重试。';}

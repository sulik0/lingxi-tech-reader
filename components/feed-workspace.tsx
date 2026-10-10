'use client';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Settings2,RefreshCw} from 'lucide-react';
import type {EventItem} from '../lib/data';
import type {CollectionPolicy} from '../lib/automation/policy';
import {validatePolicy} from '../lib/automation/policy';
import {bookmarkKey,eventMatches,isBookmarked,policyWithExclusions,readable,readBookmarks,terms,toggleBookmark,topic,visibleEvents,type APIResult,type Bookmark,type Snapshot} from '../lib/client-feed';
import FeedPreferences,{PreferenceChanges} from './feed-preferences';
import FeedItem from './feed-item';
import FeedDialog from './feed-dialog';
import FeedSettings from './feed-settings';

export default function FeedWorkspace(){
 const token=useRef(''),controller=useRef<AbortController|null>(null),revision=useRef(0),busyRef=useRef(false),returnFocus=useRef<HTMLElement|null>(null);
 const [connected,setConnected]=useState(false),[credential,setCredential]=useState(''),[data,setData]=useState<Snapshot|null>(null),[events,setEvents]=useState<EventItem[]>([]),[loadedEvents,setLoadedEvents]=useState(false);
 const [busy,setBusy]=useState(false),[reading,setReading]=useState(false),[readError,setReadError]=useState(''),[notice,setNotice]=useState(''),[noticeError,setNoticeError]=useState(false);
 const [settingsOpen,setSettingsOpen]=useState(false),[bookmarks,setBookmarks]=useState<Bookmark[]>([]),[storageError,setStorageError]=useState(''),[mode,setMode]=useState<'all'|'saved'>('all'),[limit,setLimit]=useState(20);
 const [reduce,setReduce]=useState<EventItem|null>(null),[reduction,setReduction]=useState(''),[reducePreview,setReducePreview]=useState<string[]|null>(null),[reduceError,setReduceError]=useState('');
 const api=useCallback(async<T=APIResult>(path:string,method='GET',body?:unknown,signal?:AbortSignal,credentialOverride?:string):Promise<T>=>{
   let response:Response;
   try{response=await fetch('/api/automation'+path,{method,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(path==='/report'?360000:path==='/collect'?120000:30000),headers:{Authorization:'Bearer '+(credentialOverride??token.current),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch(e){if(e instanceof Error&&e.name==='TimeoutError')throw Error('等待响应超时，请刷新查看后台结果。推送超时后请先检查群消息。');throw e;}
   let result:T&{message?:string};try{result=await response.json();}catch{throw Error(`无法读取结果（HTTP ${response.status}），请重试。`);}if(!response.ok)throw Error(result.message||`请求失败（HTTP ${response.status}）。`);return result;
 },[]);
 const refresh=useCallback(async(credentialOverride?:string)=>{
   const id=++revision.current;controller.current?.abort();const abort=new AbortController();controller.current=abort;setReading(true);setReadError('');
   const result=await Promise.allSettled([
     api<Snapshot>('','GET',undefined,abort.signal,credentialOverride).then(value=>{if(id===revision.current){setData(value);if(credentialOverride){token.current=credentialOverride;setConnected(true);setCredential('');}}return value;}),
     api<{events:EventItem[]}>('/events','GET',undefined,abort.signal,credentialOverride).then(value=>{if(id===revision.current){setEvents(value.events);setLoadedEvents(true);}return value;})
   ]);
   if(id!==revision.current)return;
   const errors:string[]=[];
   if(result[0].status==='rejected')errors.push('设置未能更新：'+errorText(result[0].reason));
   if(result[1].status==='rejected')errors.push('资讯未能更新：'+errorText(result[1].reason));
   setReadError(errors.join(' '));setReading(false);
 },[api]);
 useEffect(()=>{try{setBookmarks(readBookmarks(localStorage.getItem(bookmarkKey)));}catch{setStorageError('无法读取收藏：浏览器存储不可用或记录格式不完整。请检查浏览器设置后刷新。');}return()=>{revision.current++;controller.current?.abort();};},[]);
 useEffect(()=>{if(!connected)return;const timer=setInterval(()=>{if(!busyRef.current&&!controller.current?.signal.aborted)void refresh();},60000);return()=>clearInterval(timer);},[connected,refresh]);
 const run=async<T,>(task:()=>Promise<T>):Promise<T>=>{if(busyRef.current)throw Error('正在处理上一次操作，请稍后重试。');busyRef.current=true;setBusy(true);try{return await task();}finally{busyRef.current=false;setBusy(false);}};
 const savePolicy=async(policy:CollectionPolicy)=>run(async()=>{
   const fresh=await api<Snapshot>('');if(data&&JSON.stringify(fresh.policy)!==JSON.stringify(data.policy)){setData(fresh);throw Error('后台偏好已变更，请重新检查预览后保存。');}
   const p=validatePolicy(policy);await api('/policy','PATCH',p);setData(d=>d?{...d,policy:p}:d);await refresh();setLimit(20);
 });
 const generate=async()=>run(async()=>{
   try{
   setNotice('正在检查订阅来源…');setNoticeError(false);const collection=await api('/collect','POST');if(collection.stage==='busy')throw Error(collection.message||'后台正在运行。');
   setNotice('正在合并资讯并分析；未完成的文章会保留待处理。');const report=await api('/report','POST');if(report.stage==='busy')throw Error(report.message||'后台正在运行。');
   await refresh();setNotice((report.message||'请查看实际处理结果。')+(collection.failures?.length?` ${collection.failures.length} 个来源读取失败，资讯范围可能不完整。`:''));setNoticeError(!!collection.failures?.length);return report.digestId;
   }catch(e){setNotice(errorText(e));setNoticeError(true);throw e;}
 });
 const disconnect=()=>{revision.current++;controller.current?.abort();token.current='';setConnected(false);setData(null);setEvents([]);setLoadedEvents(false);setCredential('');setSettingsOpen(false);setReduce(null);setReadError('');setReading(false);setNotice('');setMode('all');};
 const locked=busy||!!data?.busy;
 const ready=useMemo(()=>events.filter(readable),[events]);
 const visible=useMemo(()=>data?visibleEvents(events,data.policy):[],[events,data]);
 const filtered=mode==='saved'?visible.filter(e=>isBookmarked(e,bookmarks)):visible;
 const hiddenBookmarks=ready.filter(e=>isBookmarked(e,bookmarks)&&!visible.some(v=>v.id===e.id)).length;
 const missingBookmarks=bookmarks.filter(b=>!events.some(e=>b.id===e.id||e.articles.some(a=>b.articles.includes(a.id)))).length;
 const pending=events.filter(e=>!e.demo&&e.pending).length;
 const saveBookmark=(event:EventItem)=>{try{if(storageError)throw Error('浏览器存储不可用，收藏未保存。');const next=toggleBookmark(event,bookmarks);if(next.length>2000)throw Error('收藏已达到 2000 条，请先取消部分收藏。');localStorage.setItem(bookmarkKey,JSON.stringify(next));setBookmarks(next);setNotice(isBookmarked(event,next)?'已收藏；仅保存在当前浏览器。':'已取消收藏。');setNoticeError(false);}catch(e){setStorageError(e instanceof Error&&e.name==='Error'?e.message:'收藏未保存：浏览器存储不可用或已满，请释放空间后刷新重试。');}};
 const openSettings=()=>{returnFocus.current=document.activeElement as HTMLElement;setSettingsOpen(true);};
 const openReduce=(event:EventItem)=>{returnFocus.current=document.activeElement as HTMLElement;setReduce(event);setReduction(topic(event)==='科技资讯'?'':topic(event));setReducePreview(null);setReduceError('');};
 const changeMode=(next:'all'|'saved')=>{setMode(next);setLimit(20);const url=new URL(window.location.href);if(next==='saved')url.searchParams.set('view','saved');else url.searchParams.delete('view');window.history.replaceState(window.history.state,'',url);};
 useEffect(()=>{const sync=()=>setMode(new URL(window.location.href).searchParams.get('view')==='saved'?'saved':'all');sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 const reductionPolicy=data&&reducePreview?policyWithExclusions(data.policy,reducePreview):null;
 const affected=reductionPolicy?visible.filter(e=>!eventMatches(e,reductionPolicy)).length:0;
 return <div className="feed-workspace"><a className="skip-link" href="#feed-main">跳到资讯</a><header className="feed-header"><a href="/" className="feed-brand" aria-label="灵析首页">灵析<span>个人科技信息流</span></a><button className="feed-text" onClick={openSettings}><Settings2 size={16} aria-hidden="true"/>设置</button></header><main id="feed-main" className="feed-main">
 {!connected?<section className="feed-connect"><h1>连接你的科技信息流</h1><p className="feed-help">输入管理口令，读取已聚合资讯。口令只保存在本次页面内存中。</p><form onSubmit={e=>{e.preventDefault();if(credential&&!reading)void refresh(credential);}}><label htmlFor="feed-credential">管理口令</label><div className="connect-actions"><input id="feed-credential" name="credential" type="password" spellCheck={false} autoComplete="off" value={credential} disabled={reading} onChange={e=>setCredential(e.target.value)}/><button className="feed-primary" disabled={reading||!credential}>{reading?'正在连接…':'连接'}</button></div></form></section>:data&&<FeedPreferences policy={data.policy} locked={locked} request={api} save={savePolicy}/>}
 {data?.busy&&!busy&&<p className="feed-help" role="status">后台正在处理，可继续浏览；设置与偏好暂时不能保存。</p>}{readError&&<p className="feed-error" role="alert">{readError} {loadedEvents?'已有列表已保留。':''}</p>}{storageError&&<p className="feed-error" role="alert">{storageError}</p>}{notice&&<p className={noticeError?'feed-error':'feed-notice'} role={noticeError?'alert':'status'}>{notice}</p>}
 {connected&&<section className="feed-list" data-long-list={Math.min(filtered.length,limit)>50} aria-labelledby="feed-title" aria-busy={reading}><div className="feed-toolbar"><div><h2 id="feed-title">最新资讯</h2><p>最近已分析资讯，按原文发布时间排序</p></div><button className="feed-text" disabled={reading||busy} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/>{reading?'正在刷新…':'刷新列表'}</button></div><div className="feed-tabs" aria-label="资讯视图"><button aria-pressed={mode==='all'} onClick={()=>{changeMode('all');}}>全部</button><button aria-pressed={mode==='saved'} onClick={()=>{changeMode('saved');}}>收藏</button><span>{filtered.length} 条</span></div>
 {mode==='saved'&&<p className="feed-help bookmark-help">收藏仅保存在当前浏览器，不会跨设备同步。{hiddenBookmarks?` ${hiddenBookmarks} 条收藏被当前偏好隐藏，记录仍保留。`:''}{missingBookmarks?` ${missingBookmarks} 条收藏暂不在本次返回范围内。`:''}</p>}
 {reading&&!loadedEvents?<div className="feed-skeleton" role="status" aria-label="正在载入资讯"><span/><span/><span/></div>:filtered.length?filtered.slice(0,limit).map(e=><FeedItem key={e.id} event={e} saved={isBookmarked(e,bookmarks)} onBookmark={()=>saveBookmark(e)} onReduce={()=>openReduce(e)} locked={locked}/>):<div className="feed-empty"><h3>{!loadedEvents?'资讯暂时无法读取':mode==='saved'?'还没有可显示的收藏':ready.length?'当前偏好下没有资讯':'还没有已分析资讯'}</h3><p>{!loadedEvents?'请重试刷新列表。':mode==='saved'?'在资讯右侧点击收藏，或检查当前偏好。':ready.length?'调整上方偏好后，已有资讯会重新筛选。':'可以在设置里检查新资讯并继续分析。'}</p><button className="feed-text" onClick={ready.length&&mode==='all'?()=>document.getElementById('preference-input')?.focus():openSettings}>{ready.length&&mode==='all'?'调整偏好':'打开设置'}</button></div>}
 {filtered.length>limit&&<button className="feed-secondary feed-more" onClick={()=>setLimit(n=>n+20)}>再显示 20 条</button>}{pending>0&&<p className="feed-pending">{pending} 条资讯仍待分析，尚未显示。<button className="feed-text" onClick={openSettings}>继续处理</button></p>}
 </section>}
 </main><footer className="feed-footer">依据来源正文整理，尚未独立核实。需要深入了解时，再打开原文。</footer>
 <FeedDialog open={settingsOpen} onOpenChange={setSettingsOpen} returnFocus={returnFocus} title="设置" description="管理机器人推送，按需维护来源与查看报告。">{data&&settingsOpen?<FeedSettings data={data} locked={locked} request={api} refresh={refresh} generate={generate} savePolicy={savePolicy} disconnect={disconnect}/>:<p className="feed-help">请先关闭设置，在首页输入管理口令连接。</p>}</FeedDialog>
 <FeedDialog open={!!reduce} onOpenChange={open=>{if(!open)setReduce(null);}} returnFocus={returnFocus} title="减少类似内容" description="确认后将不再展示命中该主题的资讯。你可以在偏好中移除关键词，恢复显示。">{reduce&&data&&<><p className="reduce-title">{reduce.title}</p><label className="feed-field">要减少的主题<input name="reduceTopic" autoComplete="off" maxLength={1200} value={reduction} disabled={locked} onChange={e=>{setReduction(e.target.value);setReducePreview(null);setReduceError('');}} placeholder="例如：汽车"/></label><button className="feed-secondary" disabled={locked||!terms(reduction).length} onClick={()=>{try{const words=terms(reduction);validatePolicy(policyWithExclusions(data.policy,words));setReducePreview(words);}catch(e){setReduceError(errorText(e));}}}>预览变更</button>{reductionPolicy&&<div className="preference-preview"><PreferenceChanges before={data.policy} after={reductionPolicy}/><p className="feed-help">当前列表有 {affected} 条资讯将不再显示。不会删除原文章或重新采集。</p><div className="feed-actions"><button className="feed-secondary" disabled={locked} onClick={()=>setReduce(null)}>取消</button><button className="feed-primary" disabled={locked} onClick={()=>void savePolicy(reductionPolicy).then(()=>{setReduce(null);setNotice('偏好已保存，类似内容已按关键词过滤。');setNoticeError(false);}).catch(e=>setReduceError(errorText(e)))}>确认保存</button></div></div>}{reduceError&&<p className="feed-error" role="alert">{reduceError} 偏好未保存。</p>}</>}</FeedDialog>
 </div>;
}
function errorText(e:unknown){return e instanceof Error?e.message:'读取失败，请重试。';}

'use client';
import {useEffect,useState} from 'react';
import {Radio,RefreshCw,FileText,Send,Trash2,LockKeyhole,Plus,Settings2,ChevronRight} from 'lucide-react';
import type {FeedSource,Settings,Digest,Channel} from '../lib/automation/types';
import {channelNames,deliveryNames,digestLabel,selectHistory} from '../lib/automation/presentation';
type Snapshot={settings:Settings;sources:FeedSource[];digests:Digest[];deliveries:{digest_id:string;channel:Channel;status:string;error:string;attempts:number}[];services:Record<Channel|'model',boolean>;busy:boolean;suggestedFeeds:{name:string;url:string}[];stats?:{articles:number;events:number;analyzedEvents:number;pendingArticles:number};runs?:{id:string;started_at:number;added:number;failures:string}[]};
type RunResult={message?:string;failures?:string[];digestId?:string;stage?:string};
type View='brief'|'sources'|'settings';
const dateTime=(n?:number)=>n?new Date(n).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}):'尚未检查';
function failures(raw:string):string[]{try{const value=JSON.parse(raw);return Array.isArray(value)?value.filter((v):v is string=>typeof v==='string'):[];}catch{return ['记录暂时无法读取。'];}}
function BriefBody({body}:{body:string}) {
  const [intro,...sections]=body.split(/^## /m);
  const lineView=(line:string,key:number)=>{
    if(line.startsWith('原文：')){try{const url=new URL(line.slice(3));if(url.protocol==='https:'&&!url.username&&!url.password)return <a key={key} href={url.href} target="_blank" rel="noopener noreferrer">打开原文 <ChevronRight size={14}/></a>;}catch{}}
    return <p className={line.trimStart().startsWith('原句：')?'brief-quote':line.startsWith('- ')?'brief-point':''} key={key}>{line.replace(/^- /,'• ')}</p>;
  };
  return <div className="brief-document"><p className="brief-basis">{intro.split('\n').find(line=>line.startsWith('依据'))||'依据订阅源正文整理，尚未独立核实。'}</p>{sections.map((part,index)=>{
    const [title,...lines]=part.trim().split('\n');
    const factIndex=lines.findIndex(line=>line==='事实与依据：');
    const introLines=lines.slice(0,factIndex>=0?factIndex:lines.length);
    const recommendation=lines.findIndex(line=>line.startsWith('推荐阅读：'));
    const summary=introLines.filter(line=>line.trim()&&!line.startsWith('- '));
    const points=introLines.filter(line=>line.startsWith('- ')).slice(0,3);
    const links=lines.filter(line=>line.startsWith('原文：'));
    const detail=lines.slice(factIndex>=0?factIndex:0).filter((line,i)=>line.trim()&&!line.startsWith('原文：')&&!line.startsWith('推荐阅读：')&&!/^(?:生成时)?有 \d+ 篇文章尚未完成分析/.test(line)&&!(recommendation>=0&&i+(factIndex>=0?factIndex:0)===recommendation+1));
    return <section className="brief-event" key={index}><h3>{title}</h3>{summary.map(lineView)}{points.map((line,i)=>lineView(line,summary.length+i))}
      {recommendation>=0&&<><p className="brief-recommendation">{lines[recommendation]}</p>{lines[recommendation+1]&&!lines[recommendation+1].startsWith('原文：')&&<p>{lines[recommendation+1]}</p>}</>}{links.map((line,i)=>lineView(line,100+i))}
      {!!detail.length&&<details className="brief-analysis"><summary>查看事实、观点与阅读建议</summary>{detail.map(lineView)}</details>}
    </section>;
  })}</div>;
}
export default function AutomationPanel({token,onToken}:{token:string;onToken:(token:string)=>void}) {
  const [draft,setDraft]=useState(''),[data,setData]=useState<Snapshot|null>(null),[settings,setSettings]=useState<Settings|null>(null);
  const [name,setName]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[operation,setOperation]=useState('');
  const [view,setView]=useState<View>('brief'),[preview,setPreview]=useState(false),[selected,setSelected]=useState(''),[adding,setAdding]=useState(false);
  const [notice,setNotice]=useState<{text:string;error:boolean;view:View}|null>(null);
  const request=async<T=RunResult>(path='',method='GET',body?:unknown,credential=token||draft):Promise<T>=>{
    let response:Response;
    try{response=await fetch('/api/automation'+path,{method,signal:AbortSignal.timeout(path==='/collect'?120000:['/preview','/run'].includes(path)?360000:20000),headers:{Authorization:'Bearer '+credential,...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});}catch(e){if(e instanceof Error&&['TimeoutError','AbortError'].includes(e.name))throw Error('等待响应超时。请刷新状态查看结果，暂不要重复运行推送。');throw e;}
    let result:T & {message?:string};try{result=await response.json();}catch{throw Error(`暂时无法读取结果（HTTP ${response.status}），请刷新状态。`);}if(!response.ok)throw Error(result.message||'操作失败。');return result;
  };
  const load=async(credential=token||draft)=>{const result=await request<Snapshot>('','GET',undefined,credential);setData(result);setSettings(result.settings);return result;};
  useEffect(()=>{let closed=false;if(!token){setData(null);setSettings(null);return;}
    request<Snapshot>().then(result=>{if(!closed){setData(result);setSettings(result.settings);}}).catch(e=>{if(!closed)setNotice({text:e.message,error:true,view:'brief'});});
    return()=>{closed=true;};
  },[token]);
  const act=async(task:()=>Promise<void>)=>{setBusy(true);setNotice(null);try{await task();}catch(e){setNotice({text:e instanceof Error?e.message:'操作失败，请稍后重试。',error:true,view});}finally{setBusy(false);}};
  const run=(mode:'collect'|'preview'|'run')=>{setOperation(mode);return act(async()=>{
    if(mode!=='collect'){setPreview(mode==='preview');setSelected('');}
    let result:RunResult;
    try{result=await request('/'+mode,'POST');}catch(e){await load().catch(()=>{});throw e;}
    await load();if(result.digestId)setSelected(result.digestId);
    setNotice({text:result.message||'处理完成。',error:['delivery_failed','delivery_uncertain'].includes(result.stage||''),view});
  }).finally(()=>setOperation(''));};
  const current=data?selectHistory(data.digests,preview,selected):undefined;
  const locked=busy||!!data?.busy;
  const switchView=(next:View)=>{setView(next);setNotice(null);};
  return <section className="automation-panel simplified-panel" aria-label="订阅与每日简报">
    {!data?<div className="automation-unlock"><LockKeyhole size={24}/><h2>连接你的阅读空间</h2><p>输入管理口令，查看简报、管理订阅与推送。口令只在本次页面内存中保存。</p><div className="automation-inline"><input type="password" autoComplete="off" aria-label="自动订阅管理口令" placeholder="管理口令" value={draft} onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&draft&&!busy)void act(async()=>{await load(draft);onToken(draft);});}}/><button className="primary" disabled={busy||!draft} onClick={()=>void act(async()=>{await load(draft);onToken(draft);})}>{busy?'正在连接…':'连接'}</button></div></div>:<>
    <div className="automation-overview"><div><strong>{data.sources.filter(s=>s.enabled).length} 个来源</strong><span>{data.busy?'后台正在处理':'后台自动收集'}</span></div><div className="overview-actions"><button className="text-button" disabled={busy} onClick={()=>void act(async()=>{await load();})}><RefreshCw size={14}/>刷新</button><button className="text-button" disabled={busy} onClick={()=>{onToken('');setDraft('');setData(null);}}>退出</button></div></div>
    <div className="automation-tabs" role="tablist" aria-label="订阅管理页面">{([{id:'brief',label:'每日简报',icon:FileText},{id:'sources',label:'订阅来源',icon:Radio},{id:'settings',label:'推送设置',icon:Settings2}] as const).map(({id,label,icon:Icon})=><button role="tab" aria-selected={view===id} aria-controls={'automation-'+id} id={'tab-'+id} key={id} onClick={()=>switchView(id)}><Icon size={16}/>{label}</button>)}</div>
    {notice&&notice.view===view&&<p className={`automation-notice ${notice.error?'notice-error':''}`} role={notice.error?'alert':'status'}>{notice.text}</p>}
    {view==='brief'&&<div id="automation-brief" role="tabpanel" aria-labelledby="tab-brief">
      {data.stats&&<div className="automation-counts"><div><strong>{data.stats.articles}</strong><span>已保存文章</span></div><div><strong>{data.stats.analyzedEvents}</strong><span>已分析资讯</span></div><div><strong>{data.stats.pendingArticles}</strong><span>待分析文章</span></div></div>}
      <div className="brief-toolbar"><div className="brief-mode" role="group" aria-label="简报类型"><button aria-pressed={!preview} onClick={()=>{setPreview(false);setSelected('');setNotice(null);}}>正式简报</button><button aria-pressed={preview} onClick={()=>{setPreview(true);setSelected('');setNotice(null);}}>预览 · 不发送</button></div><button className="primary" disabled={locked} onClick={()=>run('preview')}><FileText size={15}/>生成预览</button></div>
      {current?<article className="digest-card"><div className="digest-heading"><h2>{current.date} · {current.preview?'预览':'正式简报'}</h2><span className={`digest-state ${current.status==='error'&&digestLabel(current)==='生成失败'?'state-error':''}`}>{digestLabel(current)}</span></div>
        <p className="digest-meta">{current.status==='ready'&&!current.details?.legacyEmpty?'生成时间':'尝试时间'}：{dateTime(current.details?.completedAt||current.createdAt)}{current.details?.eventCount!==undefined?` · ${current.details.eventCount} 条资讯`:''}</p>
        {current.preview?<p className="delivery-note"><FileText size={15}/>预览只供阅读，不会发送。</p>:<div className="delivery-list">{[...new Set([...(['email','wecom','feishu'] as Channel[]).filter(c=>data.settings.channels[c]),...data.deliveries.filter(d=>d.digest_id===current.id).map(d=>d.channel)])].map(c=>{const row=data.deliveries.find(d=>d.digest_id===current.id&&d.channel===c);return <div key={c}><strong>{channelNames[c]}</strong><span>{row?current.details?.legacyEmpty&&row.status==='sent'?'旧空简报已发送':deliveryNames[row.status]||row.status:current.status==='ready'?'尚未发送':'尚未生成，不发送'}</span>{row?.error&&<p className="automation-error">{row.error}</p>}</div>;})}</div>}
        {current.details?.legacyEmpty&&<p className="digest-explanation">这是旧版本发送的空简报。记录会保留，但不会阻止今天继续生成有内容的简报。</p>}
        {digestLabel(current)==='等待分析'&&<p className="digest-explanation">这次生成时，文章还未完成分析，没有生成或发送简报。可以重新尝试，后台也会继续处理。</p>}
        {current.status==='empty'&&<p className="digest-explanation">没有可纳入的新内容。本次没有发送，后续发现新内容后会继续处理。</p>}
        {current.details?.pendingCount? <p className="digest-explanation">生成时有 {current.details.pendingCount} 篇未完成分析，未包含在这份简报中。</p>:null}
        {current.error&&digestLabel(current)!=='等待分析'&&<p className="automation-error" role="alert">{current.error}</p>}
        {current.body&&!current.details?.legacyEmpty&&<BriefBody body={current.body}/>}
      </article>:<div className="brief-empty"><FileText size={28}/><h2>{preview?'还没有预览':'还没有正式简报'}</h2><p>{preview?'生成预览可以先阅读已完成分析的资讯，不会发送。':'到设定时间后，后台会整理已完成分析的资讯并发送。'}</p></div>}
      <div className="daily-run"><div><strong>今日推送</strong><p>遵循已保存的时间和开关，成功发送后不会重复发送。</p></div><button className="secondary" disabled={locked||!data.settings.enabled} onClick={()=>run('run')}><Send size={15}/>检查并推送</button></div>
      <details className="automation-details"><summary>历史简报与预览</summary><div className="digest-history-list">{data.digests.map(d=><button key={d.id} onClick={()=>{setPreview(d.preview);setSelected(d.id);setNotice(null);}}><span>{d.date} · {d.preview?'预览':'正式简报'}</span><small>{digestLabel(d)}</small><time>{dateTime(d.createdAt)}</time></button>)}{!data.digests.length&&<p>暂无记录。</p>}</div></details>
      <details className="automation-details"><summary>处理记录与错误详情</summary>{data.runs?.slice(0,5).map(r=><div className="collection-entry" key={r.id}><strong>{dateTime(r.started_at)} · 新增 {r.added} 篇</strong>{!r.added&&!failures(r.failures).length&&<p>没有新文章，或文章已保存。</p>}{failures(r.failures).map((f,i)=><p className="automation-error" key={i}>{f}</p>)}</div>)}</details>
    </div>}
    {view==='sources'&&<div id="automation-sources" role="tabpanel" aria-labelledby="tab-sources"><div className="section-heading"><div><h2>订阅来源</h2><p>支持提供正文的 RSS / Atom。微信公众号需要先接入相应订阅服务。</p></div><button className="secondary" onClick={()=>setAdding(!adding)}><Plus size={15}/>{adding?'收起表单':'添加来源'}</button></div>
      {adding&&<div className="source-editor"><label>来源名称<input value={name} maxLength={60} onChange={e=>setName(e.target.value)} placeholder="例如：极客公园"/></label><label>RSS / Atom 地址<input value={url} maxLength={1500} onChange={e=>setUrl(e.target.value)} placeholder="https://…/feed"/></label><div className="source-suggestions">{data.suggestedFeeds.map(s=><button key={s.url} className="text-button" onClick={()=>{setName(s.name);setUrl(s.url);}}>{s.name}</button>)}</div><button className="primary" disabled={locked||!name.trim()||!url.trim()} onClick={()=>void act(async()=>{const result=await request('/sources','POST',{name,url});await load();setName('');setUrl('');setAdding(false);setNotice({text:result.message||'已添加。',error:false,view});})}>保存来源</button></div>}
      <div className="automation-sources">{data.sources.map(s=><div key={s.id}><div><strong>{s.name}</strong><small>{!s.enabled?'已暂停':s.error?'最近读取失败':s.lastSuccess?'最近读取成功':'等待首次检查'} · {dateTime(s.lastChecked)}</small>{s.error&&<p className="automation-error">{s.error}</p>}<details><summary>订阅地址</summary><p className="automation-url">{s.url}</p></details></div><button className={`switch ${s.enabled?'on':''}`} role="switch" aria-checked={s.enabled} aria-label={`${s.enabled?'暂停':'启用'}监听 ${s.name}`} disabled={locked} onClick={()=>void act(async()=>{await request('/sources/'+s.id,'PATCH',{enabled:!s.enabled});await load();})}><span/></button><button className="icon-button" aria-label={`删除来源 ${s.name}`} disabled={locked} onClick={()=>{if(window.confirm('删除这个订阅来源？已保存的文章会保留。'))void act(async()=>{await request('/sources/'+s.id,'DELETE',{});await load();});}}><Trash2 size={16}/></button></div>)}</div>
      <div className="section-bottom"><p>检查新文章只收集和保存，不等待模型，也不会发送。</p><button className="primary" disabled={locked} onClick={()=>run('collect')}><RefreshCw size={15}/>检查新文章</button></div>
    </div>}
    {view==='settings'&&settings&&<div id="automation-settings" role="tabpanel" aria-labelledby="tab-settings"><div className="section-heading"><div><h2>每日推送</h2><p>选择发送时间和接收渠道。</p></div><label className="automation-check"><input type="checkbox" checked={settings.enabled} onChange={e=>setSettings({...settings,enabled:e.target.checked})}/>启用推送</label></div>
      <label className="automation-field">发送时间 · 北京时间<select value={settings.sendTime} onChange={e=>setSettings({...settings,sendTime:e.target.value})}>{Array.from({length:96},(_,i)=>`${String(Math.floor(i/4)).padStart(2,'0')}:${String(i%4*15).padStart(2,'0')}`).map(t=><option key={t}>{t}</option>)}</select></label><p className="automation-help">到时后的下一次后台任务会发送。平台任务执行频率决定实际发送时间。</p>
      <div className="channel-settings">{(['feishu','wecom','email'] as Channel[]).map(c=><div className="automation-channel" key={c}><label className="automation-check"><input type="checkbox" checked={settings.channels[c]} disabled={!data.services[c]&&!settings.channels[c]} onChange={e=>setSettings({...settings,channels:{...settings.channels,[c]:e.target.checked}})}/>{channelNames[c]}</label><small>{data.services[c]?'配置已填写':'尚未配置'}</small>{c==='email'&&settings.channels.email&&<label className="automation-field">收件邮箱<input type="email" maxLength={254} value={settings.emailTo} onChange={e=>setSettings({...settings,emailTo:e.target.value})} placeholder="you@example.com"/></label>}</div>)}</div><p className="automation-help">可以选择多个渠道。机器人地址和密钥保存在服务端。</p><button className="primary" disabled={locked} onClick={()=>void act(async()=>{const result=await request('/settings','PATCH',settings);await load();setNotice({text:result.message||'设置已保存。',error:false,view});})}>保存设置</button>
      <details className="automation-details"><summary>服务状态</summary><p>{data.services.model?'模型配置已填写':'模型尚未配置'}。填写配置不代表每次调用一定成功，实际结果见处理记录。</p></details>
    </div>}
    {busy&&<p className="automation-progress" role="status"><RefreshCw size={15} className="spin"/>{operation==='collect'?'正在收集新文章…':operation?'正在分析文章，可能需要几分钟…':'正在保存或刷新…'}</p>}
    </>}{!data&&notice&&<p className="automation-error" role="alert">{notice.text}</p>}
  </section>;
}

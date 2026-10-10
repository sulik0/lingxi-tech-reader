'use client';
import {useEffect,useState} from 'react';
import type {EventItem} from '../lib/data';
export default function AutomaticReader({onEvents,onToken,token,hidden=false}:{onEvents:(events:EventItem[])=>void;onToken:(token:string)=>void;token:string;hidden?:boolean}) {
  const [draft,setDraft]=useState(''),[status,setStatus]=useState('输入管理口令，读取后台资讯。');
  useEffect(()=>{
    if(!token){onEvents([]);setStatus('输入管理口令，读取后台资讯。');return;}
    let closed=false;
    const refresh=async()=>{try{const r=await fetch('/api/automation/events',{signal:AbortSignal.timeout(20000),headers:{Authorization:'Bearer '+token}});const data=await r.json() as {events:EventItem[];message?:string};if(!r.ok)throw Error(data.message);if(!closed){onEvents(data.events);setStatus(`已同步 ${data.events.length} 条资讯`);}}catch(e){if(!closed)setStatus(e instanceof Error?e.message:'读取失败');}};
    void refresh();const timer=setInterval(refresh,60000);return()=>{closed=true;clearInterval(timer);};
  },[token,onEvents]);
  return <section hidden={hidden} className={`reader-connection ${token?'reader-connected':''}`} aria-label="自动阅读">{token?<><span>{status}</span><button className="text-button" onClick={()=>{onToken('');setDraft('');}}>退出连接</button></>:<><div><strong>连接你的阅读空间</strong><p>{status} · 连接后可同时管理订阅与推送。</p></div><div className="automation-inline"><input type="password" autoComplete="off" value={draft} aria-label="阅读管理口令" placeholder="管理口令" onChange={e=>setDraft(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&draft)onToken(draft);}}/><button className="primary" disabled={!draft} onClick={()=>onToken(draft)}>连接</button></div></>}</section>;
}

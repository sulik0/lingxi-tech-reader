'use client';
import {useEffect,useState} from 'react';
import type {EventItem} from '../lib/data';
export default function AutomaticReader({onEvents,onToken}:{onEvents:(events:EventItem[])=>void;onToken:(token:string)=>void}) {
  const [token,setToken]=useState(''),[active,setActive]=useState(''),[status,setStatus]=useState('输入管理口令，读取后台自动整理的事件。');
  useEffect(()=>{
    onToken(active);if(!active)return;
    let closed=false;
    const refresh=async()=>{try{const r=await fetch('/api/automation/events',{headers:{Authorization:'Bearer '+active}});const data=await r.json() as {events:EventItem[];message?:string};if(!r.ok)throw Error(data.message);if(!closed){onEvents(data.events);setStatus(`已同步 ${data.events.length} 个后台事件 · ${new Date().toLocaleTimeString('zh-CN')}`);}}catch(e){if(!closed)setStatus(e instanceof Error?e.message:'读取失败');}};
    void refresh();const timer=setInterval(refresh,60000);return()=>{closed=true;clearInterval(timer);};
  },[active,onEvents,onToken]);
  return <section className="automation-panel" aria-label="自动阅读"><strong>自动阅读工作台</strong><p>{status}</p>{!active?<div className="automation-inline"><input type="password" autoComplete="off" value={token} aria-label="阅读管理口令" placeholder="管理口令" onChange={e=>setToken(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')setActive(token);}}/><button className="primary" disabled={!token} onClick={()=>setActive(token)}>读取自动事件</button></div>:<button className="text-button" onClick={()=>{setActive('');setToken('');onEvents([]);setStatus('已退出，后台仍继续采集。');}}>退出阅读</button>}<small>口令只在本次页面内存中使用。来源和发送时间在订阅管理中配置。</small></section>;
}

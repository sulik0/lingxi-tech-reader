'use client';
import {useEffect,useRef,useState} from 'react';
import type {CollectionPolicy} from '../lib/automation/policy';
import {validatePolicy} from '../lib/automation/policy';
import {keywordChanges,terms,type ClientRequest} from '../lib/client-feed';

export function PreferenceChanges({before,after}:{before:CollectionPolicy;after:CollectionPolicy}){
  return <div className="preference-changes">{(['include','exclude'] as const).map(key=>{const c=keywordChanges(before[key],after[key]);return <div key={key}><strong>{key==='include'?'关注':'不看'}</strong><p>{before[key].join('、')||'无'} → {after[key].join('、')||'无'}</p><small>{c.added.length?'新增 '+c.added.join('、')+'。':''}{c.removed.length?'移除 '+c.removed.join('、')+'。':''}{c.kept.length?'保留 '+c.kept.join('、')+'。':''}{!c.added.length&&!c.removed.length?'没有变更。':''}</small></div>;})}</div>;
}
export default function FeedPreferences({policy,locked,request,save}:{policy:CollectionPolicy;locked:boolean;request:ClientRequest;save:(p:CollectionPolicy)=>Promise<void>}){
  const [input,setInput]=useState(policy.instruction),[preview,setPreview]=useState<{include:string;exclude:string}|null>(null),[working,setWorking]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(false);
  const signature=JSON.stringify(policy),lastPolicy=useRef(signature);
  useEffect(()=>{if(lastPolicy.current!==signature){lastPolicy.current=signature;setPreview(null);}},[signature]);
  useEffect(()=>{if(input===policy.instruction&&!preview)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[input,policy.instruction,preview]);
  const disabled=locked||working;
  const act=async(task:()=>Promise<void>)=>{setWorking(true);setMessage('');setError(false);try{await task();}catch(e){setError(true);setMessage(e instanceof Error?e.message:'操作失败，偏好未保存。');}finally{setWorking(false);}};
  const candidate={...policy,instruction:input,include:terms(preview?.include||''),exclude:terms(preview?.exclude||'')};
  return <section className="feed-preferences" aria-labelledby="preference-title"><h1 id="preference-title">你想关注什么？</h1><form onSubmit={e=>{e.preventDefault();if(!disabled)void act(async()=>{const value=await request<{include:string[];exclude:string[]}>('/policy/parse','POST',{instruction:input});setPreview({include:value.include.join('、'),exclude:value.exclude.join('、')});});}}><label className="sr-only" htmlFor="preference-input">用自然语言调整信息偏好</label><textarea id="preference-input" name="instruction" autoComplete="off" rows={2} maxLength={500} disabled={disabled} placeholder="不看汽车手机，多看 AI Agent" value={input} onChange={e=>{setInput(e.target.value);setPreview(null);setMessage('');}}/><div className="preference-action"><span>先查看解析结果，确认后才保存。</span><button className="feed-primary" disabled={disabled}>{working?'正在处理…':'解析偏好'}</button></div></form>
    <p className="current-preference">当前偏好：{policy.include.length?'关注 '+policy.include.join('、'):'不限关注主题'}{policy.exclude.length?'；不看 '+policy.exclude.join('、'):''}</p>
    {preview&&<div className="preference-preview" aria-label="偏好变更预览"><h2>确认这次偏好变更</h2><div className="keyword-edit"><label>关注关键词<input name="include" autoComplete="off" value={preview.include} maxLength={1200} disabled={disabled} onChange={e=>setPreview({...preview,include:e.target.value})}/></label><label>不看关键词<input name="exclude" autoComplete="off" value={preview.exclude} maxLength={1200} disabled={disabled} onChange={e=>setPreview({...preview,exclude:e.target.value})}/></label></div><PreferenceChanges before={policy} after={candidate}/><p className="feed-help">关注关键词会限定显示范围，不是提高推荐权重。保存会影响此站点后续报告与推送，不重新抓取来源。</p><div className="feed-actions"><button className="feed-secondary" disabled={disabled} onClick={()=>{setPreview(null);setMessage('');}}>取消</button><button className="feed-primary" disabled={disabled} onClick={()=>void act(async()=>{await save(validatePolicy(candidate));setPreview(null);setMessage('偏好已保存，资讯列表已按新要求更新。');})}>确认保存</button></div></div>}
    {message&&<p className={error?'feed-error':'feed-notice'} role={error?'alert':'status'}>{message}</p>}
  </section>;
}

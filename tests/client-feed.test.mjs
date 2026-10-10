import test from 'node:test';
import assert from 'node:assert/strict';
import {visibleEvents,publishedTime,safeLink,topic,toggleBookmark,isBookmarked,readBookmarks,policyWithExclusions,keywordChanges} from '../lib/client-feed.ts';
const policy={instruction:'',include:[],exclude:[],screenEnabled:true,minValue:57,deepLimit:2};
const article=(id,title='AI Agent',publishedAt=100)=>({id,title,content:title,source:'自编来源',publishedAt});
const event=(id,articles=[article(id)],extra={})=>({id,articles,demo:false,pending:false,summary:'自编摘要',category:'科技资讯',tag:'自动采集',...extra});
test('feed excludes pending/demo/empty results and sorts by actual member publication time',()=>{
 const items=[event('old',[article('a','AI',200)],{updatedAt:900}),event('new',[article('b','AI',300),article('c','AI',100)]),event('unknown',[article('d','AI',NaN)]),event('pending',undefined,{pending:true}),event('demo',undefined,{demo:true}),event('empty',undefined,{summary:' '})];
 assert.deepEqual(visibleEvents(items,policy).map(e=>e.id),['new','old','unknown']);assert.equal(publishedTime(event('bad',[article('x','AI',1e30)])),0);
});
test('keyword filtering checks every event member and never alters the source array',()=>{
 const items=[event('mixed',[article('a'),article('b','汽车换电')]),event('agent'),event('mobile',[article('phone','iPhone 手机')])];
 assert.deepEqual(visibleEvents(items,{...policy,include:['AI'],exclude:['汽车','手机']}).map(e=>e.id),['agent']);assert.equal(items.length,3);
});
test('bookmarks survive regrouping, cancel by member identity, and store identifiers only',()=>{
 const old=event('old',[article('a')]),group=event('new',[article('a'),article('b')]);
 const saved=toggleBookmark(old,[]);assert.equal(isBookmarked(group,saved),true);assert.deepEqual(toggleBookmark(group,saved),[]);
 assert.deepEqual(readBookmarks(JSON.stringify([{...saved[0],content:'should not persist'}])),saved);assert.throws(()=>readBookmarks('[{"id":"broken"}]'));assert.throws(()=>readBookmarks('invalid'));assert.deepEqual(readBookmarks(null),[]);
});
test('feedback keeps budget and previous topics; diff and link helpers avoid misleading labels',()=>{
 const next=policyWithExclusions({...policy,include:['AI'],exclude:['手机']},['汽车','手机']);assert.deepEqual(next,{...policy,include:['AI'],exclude:['手机','汽车']});
 assert.deepEqual(keywordChanges(['汽车','AI'],['AI','Agent']),{added:['Agent'],removed:['汽车'],kept:['AI']});
 assert.equal(topic(event('a')),'科技资讯');assert.equal(safeLink('javascript:alert(1)'),null);assert.equal(safeLink('https://user:pass@example.com'),null);assert.equal(safeLink('https://example.test/a'),'https://example.test/a');
});

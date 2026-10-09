import { AutomationStore } from './store.ts';
import { hash, feedURL } from './feeds.ts';
import { fetchFeed } from './feeds.ts';
import { processEvents, renderEvents } from './events.ts';
import { channelReady, deliveryPayload, sendDelivery, DeliveryError } from './delivery.ts';
import { beijingSchedule, AutomationError, type AutomationEnv, type Channel, type Digest, suggestedFeeds } from './types.ts';
export async function runAutomation(env:AutomationEnv,mode:'scheduled'|'collect'|'preview'='scheduled',now=Date.now(),fetcher:typeof fetch=fetch) {
  if(!env.DB)throw new AutomationError('后台数据库尚未配置。',503);
  const store=new AutomationStore(env.DB);let settings=await store.settings();
  const lock=await store.acquire(now);if(!lock)return {message:'已有任务在运行，请稍后查看结果。'};
  let digest:Digest|undefined;
  try {
    // Enable this only for the verified owner-private Sites deployment.
    if(env.SITES_PRIVATE_AUTOMATION==='1'&&!await store.db.prepare('SELECT id FROM automation_settings WHERE id=1').first()) {
      settings={enabled:channelReady(env).feishu,sendTime:'08:00',emailTo:'',channels:{email:false,wecom:false,feishu:channelReady(env).feishu}};
      const current=await store.sources();
      const initial=[];
      for(const feed of suggestedFeeds){try{const url=feedURL(feed.url,env.FEED_ALLOWED_HOSTS||'');if(!current.some(s=>s.url===url))initial.push({...feed,url,id:await hash(url)});}catch{}}
      await store.db.batch([store.db.prepare('INSERT OR IGNORE INTO automation_settings(id,value) VALUES(1,?)').bind(JSON.stringify(settings)),...initial.map(s=>store.db.prepare('INSERT OR IGNORE INTO feed_sources(id,name,url,enabled) VALUES(?,?,?,1)').bind(s.id,s.name,s.url))]);
    }
    const sources=(await store.sources()).filter(s=>s.enabled);
    if(!sources.length){if(mode==='scheduled')return {message:'没有启用的订阅源。'};throw new AutomationError('请先添加并启用至少一个订阅源。');}
    let added=0;const failures:string[]=[];
    for(const source of sources){try{const articles=await fetchFeed(source,env.FEED_ALLOWED_HOSTS||'',now,fetcher);added+=await store.addArticles(source.id,articles);await store.sourceResult(source.id,now,'');}catch(e){const error=e instanceof AutomationError?e.message:'读取订阅失败，请稍后重试。';failures.push(`${source.name}：${error}`);await store.sourceResult(source.id,now,error);}}
    const failedSources=failures.length;
    try{const errors=await processEvents(store,env,now,fetcher);if(errors?.length)failures.push(...errors.map(e=>'事件分析：'+e));}catch(e){failures.push('事件分析：'+(e instanceof Error?e.message:'分析失败，文章仍保留。'));}
    await store.collectionRun(now,added,failures);
    // Retention also runs when delivery is paused.
    await store.db.batch([store.db.prepare('DELETE FROM feed_articles WHERE collected_at<? AND id IN (SELECT article_id FROM digest_articles)').bind(now-14*86400000),store.db.prepare('DELETE FROM daily_digests WHERE preview=1 AND created_at<?').bind(now-7*86400000)]);
    if(mode==='scheduled'&&!settings.enabled)return {message:'已检查订阅，每日推送未启用。',failures};
    if(mode==='collect')return {message:`已检查 ${sources.length} 个来源，新增 ${added} 篇文章。`,failures};
    const schedule=beijingSchedule(now,settings.sendTime);
    if(mode==='scheduled'&&!schedule.due)return {message:'已检查订阅，尚未到发送时间。',failures};
    const id=mode==='preview'?`preview:${now}`:schedule.date;
    const previous=await store.digest(id);
    if(failedSources===sources.length&&previous?.status!=='ready')throw new AutomationError('全部订阅源读取失败，未生成或发送简报。',502);
    digest=previous||{id,date:schedule.date,status:'generating',body:'',error:'',createdAt:now,preview:mode==='preview'};
    if(digest.status!=='ready') {
      digest.status='generating';digest.error='';await store.saveDigest(digest);
      // A preview covers the preceding 24 hours; daily delivery uses fixed, non-overlapping windows.
      const articles=mode==='preview'?await store.articles(now-86400000,now):await store.pendingArticles(schedule.cutoff,241);
      const ids=new Set(articles.slice(0,24).map(a=>a.id));
      const events=(await store.events()).filter(e=>e.articles.some(a=>ids.has(a.id)));
      if(articles.slice(0,24).some(a=>a.content.length>=80&&!events.some(e=>!e.pending&&e.articles.some(b=>b.id===a.id))))throw new AutomationError('还有文章等待成功分析，未发送不完整的简报；后续任务会继续处理。',503);
      digest.body=renderEvents(schedule.date,events,failures,articles.length>24);digest.status='ready';
      if(mode==='preview')await store.saveDigest(digest);
      else await store.commitDaily(digest,[...new Set(events.flatMap(e=>e.articles.map(a=>a.id)))]);

    }
    if(mode==='preview')return {message:'预览已生成，没有发送到任何渠道。'};
    const ready=channelReady(env);
    for(const channel of ['email','wecom','feishu'] as Channel[]) {
      if(!settings.channels[channel])continue;
      const payload=deliveryPayload(channel,digest.body,digest.date,settings,env);
      await store.db.prepare("INSERT OR IGNORE INTO digest_deliveries(digest_id,channel,status,payload) VALUES(?,?,'pending',?)").bind(id,channel,ready[channel]?JSON.stringify(payload):'').run();
      if(!ready[channel]){await store.db.prepare("UPDATE digest_deliveries SET status='error',error='发送渠道尚未配置。' WHERE digest_id=? AND channel=? AND status IN ('pending','error')").bind(id,channel).run();continue;}
      await store.db.prepare("UPDATE digest_deliveries SET payload=? WHERE digest_id=? AND channel=? AND attempts=0 AND payload=''").bind(JSON.stringify(payload),id,channel).run();
      // A crashed robot send cannot be retried safely. Email uses the same payload/key within 24 hours.
      await store.db.prepare("UPDATE digest_deliveries SET status=?,error='上次发送中断，请检查是否已收到。' WHERE digest_id=? AND channel=? AND status='sending'").bind(channel==='email'?'error':'uncertain',id,channel).run();
      if(now-digest.createdAt>=23*3600000)continue;
      const claim=await store.db.prepare("UPDATE digest_deliveries SET status='sending',attempts=attempts+1,started_at=?,error='' WHERE digest_id=? AND channel=? AND status IN ('pending','error') AND attempts<3").bind(now,id,channel).run();
      if(!claim.meta.changes)continue;
      const row=await store.db.prepare('SELECT payload FROM digest_deliveries WHERE digest_id=? AND channel=?').bind(id,channel).first<{payload:string}>();
      try{await sendDelivery(channel,JSON.parse(row!.payload),`lingxi-daily/${id}/${channel}`,env,fetcher,now);await store.db.prepare("UPDATE digest_deliveries SET status='sent',error='' WHERE digest_id=? AND channel=?").bind(id,channel).run();}catch(e){const uncertain=e instanceof DeliveryError&&e.uncertain;await store.db.prepare('UPDATE digest_deliveries SET status=?,error=? WHERE digest_id=? AND channel=?').bind(uncertain&&channel!=='email'?'uncertain':'error',e instanceof DeliveryError?e.message:'发送失败，请检查服务端配置。',id,channel).run();}
    }
    return {message:'今日简报已处理，发送结果请查看记录。'};
  }catch(e){if(digest&&digest.status!=='ready'){digest.status='error';digest.error=e instanceof Error?e.message:'生成失败。';await store.saveDigest(digest);}throw e;}finally{await store.release(lock);}
}

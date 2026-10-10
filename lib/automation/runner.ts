import {selectDigestEvents} from './selection.ts';
import { AutomationStore } from './store.ts';
import { hash, feedURL } from './feeds.ts';
import { fetchFeed } from './feeds.ts';
import { processEvents, publishCollectedEvents, renderEvents } from './events.ts';
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
    if(mode==='collect')await publishCollectedEvents(store,now);
    else try{const errors=await processEvents(store,env,now,fetcher);if(errors?.length)failures.push(...errors.map(e=>'事件分析：'+e));}catch(e){failures.push('事件分析：'+(e instanceof Error?e.message:'分析失败，文章仍保留。'));}
    await store.collectionRun(now,added,failures);
    // Retention also runs when delivery is paused.
    await store.db.batch([store.db.prepare('DELETE FROM feed_articles WHERE collected_at<? AND id IN (SELECT article_id FROM digest_articles)').bind(now-14*86400000),store.db.prepare('DELETE FROM daily_digests WHERE preview=1 AND created_at<?').bind(now-7*86400000)]);
    if(mode==='scheduled'&&!settings.enabled)return {message:'已检查订阅，每日推送未启用。',failures};
    if(mode==='collect'){const stats=await store.collectionStats();return {message:`已检查 ${sources.length} 个来源，新增 ${added} 篇文章。${added===0?'没有发现新文章，已有文章不会重复入库。':''}已保存 ${stats?.articles||0} 篇，${stats?.pendingArticles||0} 篇正文等待后台分析；可在自动阅读工作台查看。`,added,failures};}
    const schedule=beijingSchedule(now,settings.sendTime);
    if(mode==='scheduled'&&!schedule.due)return {message:'已检查订阅，尚未到发送时间。',failures};
    let id=mode==='preview'?`preview:${now}`:schedule.date;
    let previous=await store.digest(id);
    // Keep the old empty message as history; permit exactly one real digest for that day.
    if(previous?.details?.legacyEmpty){id=`${schedule.date}:content`;previous=await store.digest(id);}
    if(failedSources===sources.length&&previous?.status!=='ready')throw new AutomationError('全部订阅源读取失败，未生成或发送简报。',502);
    digest=previous||{id,date:schedule.date,status:'generating',body:'',error:'',createdAt:now,preview:mode==='preview'};
    if(digest.status!=='ready') {
      digest.status='generating';digest.error='';await store.saveDigest(digest);
      // Include this cycle's collection. The send time determines when to send, not which new articles to discard.
      const articles=mode==='preview'?await store.articles(now-86400000,now+1):await store.pendingArticles(now+1,241);
      const selection=selectDigestEvents(articles,await store.events());
      const queue=mode==='preview'?null:await store.queueSummary(now+1);
      const pendingCount=queue?.pending??selection.pendingCount;
      const remainingCount=Math.max(0,(queue?.total??articles.length)-selection.articleCount);
      digest.details={articleCount:selection.articleCount,eventCount:selection.events.length,pendingCount,remainingCount,completedAt:Math.max(now,Date.now())};
      if(!selection.events.length){
        digest.status=(queue?.total??articles.length)>0?'waiting':'empty';
        digest.error='';digest.body='';await store.saveDigest(digest);
        return {stage:digest.status,digestId:id,added,failures,message:digest.status==='waiting'?'文章已保存，正在等待分析；目前没有可展示的简报，也没有发送。':'目前没有可纳入简报的新文章，没有发送；发现新内容后会继续处理。'};
      }
      digest.body=renderEvents(schedule.date,selection.events,failures.slice(0,failedSources),remainingCount>0);
      if(pendingCount)digest.body+=`\n\n生成时有 ${pendingCount} 篇文章尚未完成分析，未包含在本次简报中。`;
      digest.status='ready';
      if(mode==='preview')await store.saveDigest(digest);
      else await store.commitDaily(digest,selection.articleIds);
    }
    if(mode==='preview')return {stage:'preview',digestId:id,added,failures,message:`预览已生成${digest.details?.pendingCount?`，还有 ${digest.details.pendingCount} 篇待分析`:''}，没有发送到任何渠道。`};
    const alreadySent=new Set((await store.deliveries(id)).filter(d=>d.status==='sent').map(d=>d.channel));
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
    const deliveries=await store.deliveries(id);const names={email:'邮件',wecom:'企业微信',feishu:'飞书'};
    const selected=(['email','wecom','feishu'] as Channel[]).filter(c=>settings.channels[c]);
    const states=selected.map(channel=>{
      const row=deliveries.find(d=>d.channel===channel);
      const status=String(row?.status||'pending');
      return {channel,status,message:`${names[channel]}：${status==='sent'?(alreadySent.has(channel)?'今日已发送，不会重复发送':'发送成功'):status==='uncertain'?'无法确认送达，请先检查消息':status==='error'?'发送失败':status==='sending'?'正在发送':'等待发送'}`};
    });
    return {stage:states.some(s=>s.status==='uncertain')?'delivery_uncertain':states.some(s=>s.status==='error')?'delivery_failed':states.every(s=>s.status==='sent')&&states.length?'sent':'ready',digestId:id,added,failures,message:states.length?states.map(s=>s.message).join('；'):'简报已生成，尚未启用发送渠道。'};
  }catch(e){if(digest&&digest.status!=='ready'){digest.status='error';digest.error=e instanceof Error?e.message:'生成失败。';await store.saveDigest(digest);}throw e;}finally{await store.release(lock);}
}

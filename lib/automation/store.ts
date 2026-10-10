import { defaultSettings, type Settings, type FeedSource, type Digest, type CollectedArticle } from './types.ts';
import {defaultPolicy,validatePolicy,type CollectionPolicy} from './policy.ts';
import type {EventItem} from '../data.ts';
export class AutomationStore {
  db:D1Database;
  constructor(db:D1Database){this.db=db;}
  async policy():Promise<CollectionPolicy>{const row=await this.db.prepare('SELECT value FROM collection_policy WHERE id=1').first<{value:string}>();return row?validatePolicy(JSON.parse(row.value)):structuredClone(defaultPolicy);}
  async savePolicy(policy:CollectionPolicy){await this.db.prepare('INSERT INTO collection_policy(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').bind(JSON.stringify(validatePolicy(policy))).run();}
  async screenings(ids:string[],key:string){const rows:{article_id:string;keep:number;reason:string;stage:string}[]=[];for(let i=0;i<ids.length;i+=90){const batch=ids.slice(i,i+90);rows.push(...(await this.db.prepare('SELECT article_id,keep,reason,stage FROM article_screenings WHERE policy_key=? AND article_id IN ('+batch.map(()=>'?').join(',')+')').bind(key,...batch).all<{article_id:string;keep:number;reason:string;stage:string}>()).results);}return new Map(rows.map(r=>[r.article_id,r]));}
  async filteredCount(key:string,start:number,cutoff:number){return (await this.db.prepare('SELECT COUNT(*) AS count FROM article_screenings s JOIN feed_articles a ON a.id=s.article_id WHERE s.policy_key=? AND s.keep=0 AND a.published_at>=? AND a.collected_at<? AND a.source_id IN (SELECT id FROM feed_sources WHERE enabled=1) AND a.id NOT IN (SELECT article_id FROM digest_articles)').bind(key,start,cutoff).first<{count:number}>())?.count||0;}
  async screening(id:string,key:string){return await this.db.prepare('SELECT keep,reason,stage FROM article_screenings WHERE article_id=? AND policy_key=?').bind(id,key).first<{keep:number;reason:string;stage:string}>();}
  async saveScreening(id:string,key:string,keep:boolean,reason:string,stage:string,now:number){await this.db.prepare('INSERT INTO article_screenings(article_id,policy_key,keep,reason,stage,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(article_id,policy_key) DO UPDATE SET keep=excluded.keep,reason=excluded.reason,stage=excluded.stage,created_at=excluded.created_at').bind(id,key,+keep,reason,stage,now).run();}
  async recordUsage(stage:string,model:string,prompt:number|null,completion:number|null){await this.db.prepare('INSERT INTO model_usage(id,stage,model,prompt_tokens,completion_tokens,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),stage,model,prompt,completion,Date.now()).run();}
  async usage(since=Date.now()-86400000){return (await this.db.prepare('SELECT stage,model,COUNT(*) AS calls,SUM(prompt_tokens) AS promptTokens,SUM(completion_tokens) AS completionTokens,SUM(CASE WHEN prompt_tokens IS NULL OR completion_tokens IS NULL THEN 1 ELSE 0 END) AS unknownCalls FROM model_usage WHERE created_at>=? GROUP BY stage,model').bind(since).all()).results;}
  async settings():Promise<Settings>{const row=await this.db.prepare('SELECT value FROM automation_settings WHERE id=1').first<{value:string}>();return row?JSON.parse(row.value):structuredClone(defaultSettings);}
  async saveSettings(settings:Settings){await this.db.prepare('INSERT INTO automation_settings(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').bind(JSON.stringify(settings)).run();}
  async sources():Promise<FeedSource[]>{const {results}=await this.db.prepare('SELECT * FROM feed_sources ORDER BY name').all<any>();return results.map(s=>({id:s.id,name:s.name,url:s.url,enabled:!!s.enabled,lastChecked:s.last_checked,lastSuccess:s.last_success,error:s.error}));}
  async addSource(source:FeedSource){await this.db.prepare('INSERT INTO feed_sources(id,name,url,enabled) VALUES(?,?,?,?)').bind(source.id,source.name,source.url,+source.enabled).run();}
  async toggleSource(id:string,enabled:boolean){await this.db.prepare('UPDATE feed_sources SET enabled=? WHERE id=?').bind(+enabled,id).run();}
  async deleteSource(id:string){await this.db.prepare('DELETE FROM feed_sources WHERE id=?').bind(id).run();}
  async sourceResult(id:string,now:number,error:string){await this.db.prepare("UPDATE feed_sources SET last_checked=?, error=?, last_success=CASE WHEN ?='' THEN ? ELSE last_success END WHERE id=?").bind(now,error,error,now,id).run();}
  async addArticles(sourceId:string,articles:CollectedArticle[]) {
    let added=0;
    for(const a of articles) {
      const results=await this.db.batch([
        this.db.prepare('INSERT OR IGNORE INTO feed_articles(id,source_id,source,title,author,content,url,published_at,collected_at,content_hash) SELECT ?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM article_seen WHERE source_id=? AND (article_id=? OR url=? OR content_hash=?)) AND NOT EXISTS (SELECT 1 FROM feed_articles WHERE source_id=? AND content_hash=?)').bind(a.id,sourceId,a.source,a.title,a.author,a.content,a.url,a.publishedAt,a.collectedAt,a.contentHash,sourceId,a.id,a.url,a.contentHash,sourceId,a.contentHash),
        this.db.prepare('INSERT OR IGNORE INTO article_seen(source_id,article_id,url,content_hash) VALUES(?,?,?,?)').bind(sourceId,a.id,a.url,a.contentHash)
      ]);added+=results[0].meta.changes||0;
    }
    return added;
  }
  async articles(start:number,cutoff:number,policyKey=''):Promise<CollectedArticle[]>{const {results}=await this.db.prepare('SELECT * FROM feed_articles WHERE published_at>=? AND published_at<? AND source_id IN (SELECT id FROM feed_sources WHERE enabled=1) AND id NOT IN (SELECT article_id FROM article_screenings WHERE policy_key=? AND keep=0) ORDER BY published_at DESC LIMIT 241').bind(start,cutoff,policyKey).all<any>();return results.map(a=>({id:a.id,source:a.source,title:a.title,author:a.author,content:a.content,url:a.url,publishedAt:a.published_at,collectedAt:a.collected_at,contentHash:a.content_hash}));}
  async pendingArticles(cutoff:number,limit=24,policyKey=''):Promise<CollectedArticle[]> {
    const {results}=await this.db.prepare('SELECT * FROM feed_articles WHERE collected_at<? AND source_id IN (SELECT id FROM feed_sources WHERE enabled=1) AND id NOT IN (SELECT article_id FROM digest_articles) AND id NOT IN (SELECT article_id FROM article_screenings WHERE policy_key=? AND keep=0) ORDER BY collected_at ASC,id LIMIT ?').bind(cutoff,policyKey,limit).all<any>();
    return results.map(a=>({id:a.id,source:a.source,title:a.title,author:a.author,content:a.content,url:a.url,publishedAt:a.published_at,collectedAt:a.collected_at,contentHash:a.content_hash}));
  }
  async events():Promise<EventItem[]> {const {results}=await this.db.prepare('SELECT value FROM reading_events ORDER BY updated_at DESC LIMIT 200').all<{value:string}>();return results.map(r=>JSON.parse(r.value));}
  async saveEvents(events:EventItem[],obsolete:string[]=[]) {
    if(!events.length)return;
    await this.db.batch([...obsolete.map(id=>this.db.prepare('DELETE FROM reading_events WHERE id=?').bind(id)),...events.flatMap(e=>[this.db.prepare('INSERT INTO reading_events(id,value,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(e.id,JSON.stringify(e),e.updatedAt||Date.now()),...e.articles.map(a=>this.db.prepare('INSERT INTO event_articles(article_id,event_id) VALUES(?,?) ON CONFLICT(article_id) DO UPDATE SET event_id=excluded.event_id').bind(a.id,e.id))])]);
  }
  async eventForArticle(id:string){return (await this.db.prepare('SELECT event_id FROM event_articles WHERE article_id=?').bind(id).first<{event_id:string}>())?.event_id;}
  async unprocessed(limit=24,includePending=true,policyKey=''):Promise<CollectedArticle[]> {
    const {results}=await this.db.prepare("SELECT * FROM feed_articles WHERE (id NOT IN (SELECT article_id FROM event_articles) OR id IN (SELECT ea.article_id FROM event_articles ea JOIN reading_events re ON re.id=ea.event_id WHERE json_extract(re.value,'$.pending')=1 AND length(content)>=80 AND ?=1)) AND source_id IN (SELECT id FROM feed_sources WHERE enabled=1) AND id NOT IN (SELECT article_id FROM article_screenings WHERE policy_key=? AND keep=0) ORDER BY COALESCE((SELECT re.updated_at FROM event_articles ea JOIN reading_events re ON re.id=ea.event_id WHERE ea.article_id=feed_articles.id),collected_at) ASC,id LIMIT ?").bind(+includePending,policyKey,limit).all<any>();
    return results.map(a=>({id:a.id,source:a.source,title:a.title,author:a.author,content:a.content,url:a.url,publishedAt:a.published_at,collectedAt:a.collected_at,contentHash:a.content_hash}));
  }
  async collectionRun(now:number,added:number,failures:string[]){await this.db.prepare('INSERT INTO collection_runs(id,started_at,added,failures) VALUES(?,?,?,?)').bind(crypto.randomUUID(),now,added,JSON.stringify(failures)).run();}
  async runs(){return (await this.db.prepare('SELECT * FROM collection_runs ORDER BY started_at DESC LIMIT 20').all()).results;}
  async collectionStats(){return await this.db.prepare("SELECT (SELECT COUNT(*) FROM feed_articles) AS articles, (SELECT COUNT(*) FROM reading_events) AS events, (SELECT COUNT(*) FROM reading_events WHERE json_extract(value,'$.pending')=0) AS analyzedEvents, (SELECT COUNT(*) FROM feed_articles WHERE length(content)>=80 AND (id NOT IN (SELECT article_id FROM event_articles) OR id IN (SELECT ea.article_id FROM event_articles ea JOIN reading_events re ON re.id=ea.event_id WHERE json_extract(re.value,'$.pending')=1))) AS pendingArticles").first<{articles:number;events:number;analyzedEvents:number;pendingArticles:number}>();}
  async commitDaily(d:Digest,ids:string[]) {
    await this.db.batch([this.db.prepare("UPDATE daily_digests SET status='ready',body=?,error='',details=? WHERE id=?").bind(d.body,JSON.stringify(d.details||{}),d.id),...ids.map(id=>this.db.prepare('INSERT OR IGNORE INTO digest_articles(article_id,digest_id) VALUES(?,?)').bind(id,d.id))]);
  }
  private readDigest(d:any):Digest {
    let details;try{details=JSON.parse(d.details||'{}');}catch{details={};}
    const legacyEmpty=!d.preview&&d.status==='ready'&&d.reported_count===0&&/本次整理 0 (个事件|条资讯)/.test(d.body);
    return {id:d.id,date:d.date,status:d.status,body:d.body,error:d.error,createdAt:d.created_at,preview:!!d.preview,details:{...details,...(legacyEmpty?{articleCount:0,eventCount:0,legacyEmpty:true}:{})}};
  }
  async digests():Promise<Digest[]> {
    // Preview attempts must not crowd all daily records out of the history.
    const {results}=await this.db.prepare('SELECT d.*, (SELECT COUNT(*) FROM digest_articles WHERE digest_id=d.id) AS reported_count FROM daily_digests d WHERE d.id IN (SELECT id FROM daily_digests WHERE preview=0 ORDER BY created_at DESC LIMIT 10) OR d.id IN (SELECT id FROM daily_digests WHERE preview=1 ORDER BY created_at DESC LIMIT 10) ORDER BY created_at DESC').all<any>();
    return results.map(d=>this.readDigest(d));
  }
  async digest(id:string):Promise<Digest|null>{const d=await this.db.prepare('SELECT d.*, (SELECT COUNT(*) FROM digest_articles WHERE digest_id=d.id) AS reported_count FROM daily_digests d WHERE d.id=?').bind(id).first<any>();return d?this.readDigest(d):null;}
  async saveDigest(d:Digest){await this.db.prepare('INSERT INTO daily_digests(id,date,status,body,error,created_at,preview,details) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,body=excluded.body,error=excluded.error,details=excluded.details').bind(d.id,d.date,d.status,d.body,d.error,d.createdAt,+d.preview,JSON.stringify(d.details||{})).run();}
  async queueSummary(cutoff:number,policyKey='') {
    return await this.db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN length(a.content)>=80 AND (e.id IS NULL OR json_extract(e.value,'$.pending')=1) THEN 1 ELSE 0 END) AS pending FROM feed_articles a LEFT JOIN event_articles ea ON ea.article_id=a.id LEFT JOIN reading_events e ON e.id=ea.event_id WHERE a.collected_at<? AND a.source_id IN (SELECT id FROM feed_sources WHERE enabled=1) AND a.id NOT IN (SELECT article_id FROM digest_articles) AND a.id NOT IN (SELECT article_id FROM article_screenings WHERE policy_key=? AND keep=0)").bind(cutoff,policyKey).first<{total:number;pending:number}>();
  }
  async deliveries(id?:string){return (await this.db.prepare('SELECT digest_id,channel,status,attempts,started_at,error FROM digest_deliveries'+(id?' WHERE digest_id=?':' ORDER BY started_at DESC LIMIT 30')).bind(...(id?[id]:[])).all()).results;}
  async acquire(now:number){const holder=crypto.randomUUID();const r=await this.db.prepare('INSERT INTO automation_lock(id,holder,expires_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET holder=excluded.holder,expires_at=excluded.expires_at WHERE automation_lock.expires_at<?').bind(holder,now+12*60000,now).run();return r.meta.changes?holder:null;}
  async release(holder:string){await this.db.prepare('DELETE FROM automation_lock WHERE holder=?').bind(holder).run();}
  async busy(now:number){return !!await this.db.prepare('SELECT holder FROM automation_lock WHERE expires_at>?').bind(now).first();}
}

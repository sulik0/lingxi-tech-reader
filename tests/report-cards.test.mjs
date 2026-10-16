import test from 'node:test';
import assert from 'node:assert/strict';
import {reportCards} from '../lib/report-cards.ts';
test('cards retain summaries and evidence but never expose verbose article assessments',()=>{
 const body='# 报告\r\n依据原文\r\n## 自编事件\r\n模型开放本地部署。\r\n- 内存为 16 GB。\r\n事实与依据：\r\n- 硬件数据（待核实）\r\n  原句：16 GB\r\n作者观点：\r\n- 作者认为值得尝试。\r\n文章提供的新信息：\r\n- 全文评价与重复度。\r\n推荐阅读：自编报道\r\n本次只提供该文部分片段，无法评价全文。\r\n原文：https://example.test/a\r\n参考：另一报道｜https://other.test/b\r\n阅读建议：长篇阅读建议。\r\n尚不确定：数据未核实。';
 const [c]=reportCards(body);assert.equal(c.title,'自编事件');assert.deepEqual(c.summary,['模型开放本地部署。','- 内存为 16 GB。']);assert.equal(c.sources.length,2);assert.equal(c.sources[0].title,'自编报道');assert.equal(c.sources[0].recommended,true);assert.match(c.details.join('\n'),/原句：16 GB/);assert.match(c.details.join('\n'),/尚不确定/);assert.doesNotMatch(JSON.stringify(c),/无法评价全文|全文评价|长篇阅读建议/);
});
test('cards reject unsafe links, deduplicate sources and handle missing fact headings',()=>{
 const [c]=reportCards('## 自编事件\n简短摘要\n推荐阅读：自编文\n长理由\n原文：javascript:alert(1)\n原文：https://user:pass@example.test/a\n原文：https://example.test/a\n参考：转载｜https://example.test/a\n参考：其他｜https://other.test/b');assert.deepEqual(c.summary,['简短摘要']);assert.deepEqual(c.sources.map(s=>s.href),['https://example.test/a','https://other.test/b']);assert.doesNotMatch(c.summary.join(''),/长理由/);assert.deepEqual(reportCards('# 没有事件\n等待采集'),[]);assert.deepEqual(reportCards('## \n\n'),[]);
});

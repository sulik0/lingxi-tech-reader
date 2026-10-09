# 真实数据的质量验证

结构化输出和引用校验只是最低要求，不能代替人工判断事件分组和新增信息。真实正文不提交 Git，测试集与模型结果放在忽略的 `work/quality/`。

准备 10–30 个案例，每个案例至少两篇真实文章，涵盖同一事件不同标题、相似标题不同事件、转载、测评和观点。人工逐篇检查后填写：

```json
{
  "name": "具体事件名称",
  "reviewed": true,
  "articles": [{"id":"a","title":"标题","source":"来源","author":"作者","content":"真实正文","url":"https://原文地址","publishedAt":0,"collectedAt":0,"contentHash":"正文哈希"}],
  "expectedGroups": [["a", "b"]],
  "expectedBest": "b",
  "expectedDuplicates": ["a"],
  "expectedGains": [{"id":"b","text":"独有的实测数据或技术细节"}]
}
```

示例仅说明字段，不是已标注案例；实际 articles 至少两篇，全部 ID 必须被人工分组恰好覆盖一次。还应在本地人工备注中标记事实原句、作者观点、推测与推荐依据。

```sh
node --env-file=.dev.vars scripts/evaluate-quality.mjs work/quality/cases.json
```

脚本调用真实模型，计算两两文章分组的误合并、漏合并、precision 和 recall，比较推荐文章和预期转载，并将新增信息与分析结果写入同目录结果文件供人工审阅。新增信息、观点和推荐理由不能只凭字符串相同自动判断，需要人工检查正文。

缺少人工标注或案例数量不足时，脚本拒绝运行。不能把下载了 80 篇文章、模型格式校验通过或所有文章各自成组写成完成了这个质量验收。修改 Prompt、分组或模型后重新运行同一批已审核案例，并保留模型名称与时间。

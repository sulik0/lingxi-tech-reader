# 灵析 · 科技信息去噪

以事件为中心的公众号阅读 MVP。包含事件雷达、四维文章评分、事实证据链、作者观点、重复与夸张判断、单篇推荐、综合简报、收藏、阅读历史、来源管理和文章导入。

## 当前可以使用

- 六个虚构事件、24 篇虚构文章组成的完整演示工作台；所有示例均标注演示。
- 分类、关键词、时间、未读和排序筛选。
- 收藏、阅读记录、文章正文导入、同正文去重、相似标题分组。
- 本地浏览器持久化与 JSON 数据导出；事件简报导出 Markdown。
- 服务端兼容 Chat Completions 的 LLM 分析接口；未配置服务返回 503，界面保留待分析状态。
- 事实来源必须对应文章 ID，证据必须逐字存在于来源正文。未经外部核验的分析不得标为“已核验”。

## 接入真实模型

在 Sites 运行环境中配置密钥，禁止写入源代码或浏览器：

- `LLM_API_KEY`：你授权使用的模型服务密钥。
- `LLM_BASE_URL`：HTTPS API 基础地址，包含所需版本路径；系统会追加 `/chat/completions`。
- `LLM_MODEL`：所配置服务支持的模型名称。

接口需要支持 JSON mode。仅在用户点击交叉分析时发送导入正文；限制 12 篇、每篇 16,000 字、合计 72,000 字，55 秒请求超时。错误不会伪装为成功。没有全网事实核验，也没有自动浏览链接。

如使用 OpenAI 密钥，按 Sites 的 OpenAI Developers 插件流程进行授权与配置。

## 自动采集的边界

当前没有接入微信账号、授权文章服务或 RSS 数据源。添加公众号名称只管理来源，不能直接读取用户的微信订阅列表。正式自动采集需要已授权的内容接口：采集 → 清洗正文与来源 → URL/正文指纹去重 → 事件实体、版本及时间抽取 → 语义聚类 → LLM 对照 → 证据校验 → 入库。

生产扩展建议使用 D1 存储按用户隔离的 sources/articles/events/claims/evaluations，R2 存储授权正文；对采集任务增加调度、幂等、错误恢复。当前文章和收藏仅在此浏览器 localStorage 中，不跨设备同步，最多存储 40 篇导入文章。

原创度与重复度只相对同组已导入文章，不代表全网原创检测；分数是模型判断，不能作为绝对事实。多源一致不代表来源独立，也不代表已核验。

## GitHub 与持续更新

仓库：<https://github.com/sulik0/lingxi-tech-reader>（私人仓库，默认分支 `main`）。

按用户要求，本项目后续每次修改完成并通过必要检查后，都会创建 Git 提交并推送更新。该约定保存于 `AGENTS.md`。GitHub Actions 在每次推送后运行类型检查、分析验证测试与生产构建。

本次仅上传源码，没有发布在线网站；自动采集和真实模型服务仍需另行配置。

## 本地开发

推荐 Node.js 24（`.nvmrc`）；框架要求至少 22.13。克隆后：

```sh
git clone https://github.com/sulik0/lingxi-tech-reader.git
cd lingxi-tech-reader
npm run install:ci
npm run dev
```

开发地址：`http://localhost:5173`。验证与构建：

```sh
npm run typecheck
npm test
npm run build
```

本地模型配置可以从 `.env.example` 复制到 `.dev.vars` 后填写，重启开发服务。`.dev.vars` 被 Git 忽略，不会上传。线上密钥使用部署平台的运行环境配置。

使用 Sites Vinext/Cloudflare Workers starter，保留 `build/sites-worker.ts` 的请求上下文。API 在 Worker 入口处理，以读取运行环境密钥；API 返回 `private, no-store`，只接受同源 JSON POST。

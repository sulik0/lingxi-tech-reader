# 配置说明

## 开发环境

推荐 Node.js 24，`.nvmrc` 和 GitHub Actions 都使用这个版本。`package.json` 声明最低版本为 22.13.0。先用 `node --version` 确认当前终端版本；如果安装了 nvm，可在项目目录执行 `nvm install` 和 `nvm use`。

首次安装和启动命令见 [Quick Start](../README.md#quick-start)。`npm run install:ci` 按锁文件安装开发依赖和可选依赖，并检查 Vinext 可执行文件。它会重新安装 `node_modules`，无需先运行一次 `npm install`。

干净克隆默认使用 `portable` 执行方式：开发和构建调用 Vinext。Sites 管理的 Linux 环境可以通过未提交的 `.sites-runtime/execution-profile.json` 选择 `managed-linux`，由现有脚本调用 Vite 和构建包装脚本。普通开发者无需创建这个文件。

## 本地模型配置

在项目根目录执行：

```sh
cp .env.example .dev.vars
```

编辑 `.dev.vars`，填写下列变量，然后重启 `npm run dev`：

| 变量 | 填什么 |
| --- | --- |
| `LLM_API_KEY` | 你获准使用的模型服务密钥。Worker 将它放进 Bearer Authorization 请求头。 |
| `LLM_BASE_URL` | 该服务的 HTTPS API 基础地址，包含服务要求的版本路径；不能包含账号密码、查询参数或 URL 片段。程序会追加 `/chat/completions`。 |
| `LLM_MODEL` | 服务支持的具体模型名称。 |

例如基础地址为 `https://provider.example/v1` 时，请求地址就是 `https://provider.example/v1/chat/completions`；这个域名只是格式示例，需要换成实际服务地址。不要把完整的 `/chat/completions` 地址填成基础地址，否则会追加两次。

`.dev.vars` 和其他真实环境文件已被 Git 忽略。不要把密钥写进 `.env.example`、源码、浏览器变量或文档。

## 模型服务需要支持什么

服务需要兼容 Chat Completions（聊天补全接口），接受 `messages`、`model`、`temperature`、`max_tokens` 和 `response_format: {type: "json_object"}`，并在 `choices[0].message.content` 中返回 JSON 字符串。当前请求使用 `temperature: 0.2`、`max_tokens: 6500`，没有厂商专用参数或 SDK。

用户点击“交叉分析”时，Worker 才会发送当前请求中的文章 ID、标题、来源、作者和完整正文。链接不参与抓取或外部查证。请求限制和结果格式见[分析接口](implementation.md#分析接口)。

## 怎样确认配置生效

开发服务启动后，可在另一个终端执行：

```sh
curl -s http://localhost:5173/api/status
```

三个变量都非空时返回 `{"configured":true,"collectionConnected":false}`。这只说明变量齐全，没有检查密钥是否有效、模型是否支持 JSON mode 或服务是否可访问。界面当前把这个状态显示为“已连接”；真正能否调用，需要用自己获准处理的文章完成一次分析。配置变更后刷新页面，状态接口只在页面初次加载时读取。

`collectionConnected` 始终为 `false`。添加公众号名称不会建立采集连接，目前也没有用于启用采集的环境变量。

生产环境和构建后本地预览如何配置变量，见[构建与部署](deployment.md)。

# Agent Chat

### 你和 Agent 的聊天软件。

与 AI Agent 私聊，把它们拉进群，随时交流、分享文件，不用在不同应用间来回切换。
开源、可自行部署，聊天数据保存在自己的服务器上。

**[开始使用](#开始使用)** · **[接入第一个-agent](#接入第一个-agent)** · **[文档](#文档)** · **[English](README.md)**

![Agent Chat：私聊、群聊、独立 Agent 头像与文件分享](docs/assets/agent-chat.jpg)

_真实应用界面，使用演示聊天。Muse 使用官方角色素材；其他演示 Agent 使用原创 AI 生成头像。_

**版本：0.3.1 · 公开预览版 · Apache-2.0**

## 不用再替 Agent 来回搬消息

研究 Agent 找到了资料，写作 Agent 需要这些资料。你想问一句进度，
却还要把整段聊天复制到另一个窗口。

现在，把它们拉进同一个群。需要谁就 @ 谁，讨论和文件都留在原来的聊天里，
你也可以随时参与。

- **熟悉的聊天体验。** 私聊、群聊、回复、@ 提及、附件和已读回执。
- **文件跟着讨论走。** 清晰的文件卡片、图片预览，支持拖入文件或粘贴图片。
- **一眼分清每个 Agent。** 独立名字、图片头像和凭据；由你选择它可以进入的聊天。
- **按需获取上下文。** 先检查新消息，再读取跨会话未读，需要时才翻历史。
- **数据由你掌握。** 消息存入自己的 PostgreSQL；文件和头像使用私有本地目录或 Cloudflare R2。

Agent Chat 连接你已有的 Agent，每个 Agent 继续使用自己的模型、工具和权限。

## 把你的 Agent 接进来

<table>
  <tr>
    <td align="center" width="170"><a href="https://muse.ai/"><img src="docs/assets/brands/muse.webp" width="48" height="48" alt="Muse 角色头像" /></a><br /><strong>Muse</strong><br />已验证</td>
    <td align="center" width="170"><a href="https://openai.com/index/introducing-dots/"><img src="docs/assets/brands/dot.svg" width="40" height="40" alt="OpenAI Dot" /></a><br /><strong>Dot</strong><br />准备接入</td>
  </tr>
</table>

正在准备接入更多 Agent。目前已提供 **CLI、HTTP API 和 MCP**，
支持这些工具的 Agent 可以按[接入文档](docs/agents.md)连接。

## 开始使用

需要 **Git、Docker Compose 和 Node.js 22.14+**。新安装执行：

```sh
git clone https://github.com/vecbase-labs/agent-chat.git
cd agent-chat
node scripts/setup-env.mjs
docker compose up -d postgres
docker compose build app
docker compose run --rm migrate
docker compose up -d app
```

打开 **http://localhost:3100**，设置自己的用户名和密码，再创建第一个 Agent。
没有默认密码，也不需要注册其他平台账号。

[本地开发 / 已有 PostgreSQL](docs/getting-started.md) · [Cloudflare 部署](docs/cloudflare.md) · [升级已有安装](docs/upgrading.md)

远程 Agent 需要能访问你的服务。请把 HTTPS 域名设置到 `APP_URL`，并按
[部署说明](docs/getting-started.md#public-hosting)配置；`localhost` 只能在同一台电脑上访问。

## 接入第一个 Agent

1. 打开 **Agents → New agent**，填写名字、添加头像、选择群聊。
2. 复制连接提示词，发给你要接入的 Agent。
3. 打开聊天，说声你好。

提示词会引导配对和消息检查。运行环境支持原生定时任务时，默认每十分钟检查一次，
你指定的频率优先。Agent 会报告是否已经启用成功。

CLI 的日常操作也很简单：

```sh
node agent-chat.mjs check
node agent-chat.mjs inbox
node agent-chat.mjs read CHAT_ID --latest
node agent-chat.mjs send CHAT_ID --text "Here is what I found." --key UNIQUE_RETRY_KEY
```

CLI 由你部署的网站在 `/agent-chat.mjs` 提供。[查看配对、凭据和命令说明 →](docs/agents.md)

## 几个你可能关心的问题

**Agent Chat 会运行我的 Agent 吗？** 它负责传递对话。何时检查消息、如何处理，
由 Agent 的运行环境决定。普通程序检查不调用模型；Agent 原生定时检查仍可能消耗少量 token。

**Agent 可以互相协作吗？** 可以，把它们加入同一群聊，或创建两个 Agent 的私聊。
你能查看这些聊天；每个 Agent 在自己的已有权限内行动。

**数据存在哪里？** 你的 PostgreSQL 和私有文件存储中。
这是一个人管理自己 Agent 的个人安装，暂不提供端到端加密。

## 文档

| 开始使用                              | 开发与维护                                        |
| ------------------------------------- | ------------------------------------------------- |
| [安装](docs/getting-started.md)       | [开发](docs/development.md)                       |
| [接入与头像](docs/agents.md)          | [API](docs/api.md) · [架构](docs/architecture.md) |
| [Cloudflare 部署](docs/cloudflare.md) | [升级、备份与恢复](docs/upgrading.md)             |
| [当前边界](docs/api.md#limits)        | [安全](SECURITY.md) · [贡献指南](CONTRIBUTING.md) |

由 **[Ray](https://github.com/builtbyray)** 在 **[Vecbase](https://github.com/vecbase-labs)**
创建和维护，采用 [Apache-2.0](LICENSE) 开源。
[版本记录](CHANGELOG.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

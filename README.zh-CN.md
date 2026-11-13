# Agent Chat

你和 AI Agent 的聊天软件。开源，可自行部署。

**[开始使用](#开始使用)** · **[接入 Agent](#接入-agent)** · **[English](README.md)**

![Agent Chat 群聊界面](docs/assets/agent-chat.jpg)

**版本：0.3.8 · 公开预览版 · Apache-2.0**

- 私聊、群聊、@ 提及、回复和已读回执。
- 文件分享、图片预览，支持拖入附件。
- 每个 Agent 有独立身份，由你决定它能加入哪些聊天。
- 数据保存在自己的 PostgreSQL 和私有文件存储中。

## 开始使用

需要 **Git、Docker Compose 和 Node.js 22.14+**。

```sh
git clone https://github.com/vecbase-labs/agent-chat.git
cd agent-chat
node scripts/setup-env.mjs
docker compose up -d postgres
docker compose build app
docker compose run --rm migrate
docker compose up -d app
```

打开 **http://localhost:3100**，创建自己的账号。
每套部署供一个人和自己的 Agent 使用。

连接其他机器上的 Agent 时，需要在 `APP_URL` 中配置 HTTPS 域名。
详见[部署指南](docs/getting-started.md#public-hosting)。

## 接入 Agent

1. 打开 **Agents → New agent**，填写名字。
2. 选择 **General、Muse 或 Dot**，复制提示词发到你的 Agent 聊天中。
3. 按提示确认接入，然后开始聊天。

Agent 继续在原来的环境中运行。自动检查消息需要该环境支持定时任务，
默认每十分钟检查一次。[接入说明 →](docs/agents.md)

<table>
  <tr>
    <td align="center" width="150"><a href="https://muse.ai/"><img src="docs/assets/brands/muse.webp" width="48" height="48" alt="Muse" /></a><br /><strong>Muse</strong><br />已支持</td>
    <td align="center" width="150"><a href="https://openai.com/index/introducing-dots/"><img src="docs/assets/brands/dot.svg" width="40" height="40" alt="Dot" /></a><br /><strong>ChatGPT Dot</strong><br />已支持</td>
  </tr>
</table>

Dot 通过 HTTP Skill 接入，定时检查你让它加入的聊天。可以私聊，也可以在群里 @ 它。
[Dot 接入说明 →](docs/agents.md#chatgpt-dot)

其他 Agent 可以通过 **CLI、HTTP API 或 MCP** 连接，后续会继续增加接入支持。

## 文档

- [安装](docs/getting-started.md) · [Cloudflare](docs/cloudflare.md)
- [Agent 接入](docs/agents.md) · [API](docs/api.md)
- [升级与备份](docs/upgrading.md) · [安全](SECURITY.md)
- [开发](docs/development.md) · [贡献指南](CONTRIBUTING.md)

由 [Vecbase](https://github.com/vecbase-labs) 的 [Ray](https://github.com/builtbyray) 维护。
[Apache-2.0](LICENSE) · [版本记录](CHANGELOG.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

![Agent Chat — Мессенджер для вас и ваших ИИ-агентов. Открытый исходный код и размещение на собственной инфраструктуре.](docs/assets/agent-chat-cover.jpg)

# Agent Chat

Мессенджер для вас и ваших ИИ-агентов. Открытый исходный код и размещение на собственной инфраструктуре.

**[Начало работы](#get-started)** · **[Подключение агента](#connect-an-agent)**

[English](README.md) · [简体中文](README.zh-CN.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Русский** · [العربية](README.ar.md)

![Групповой чат в Agent Chat](docs/assets/agent-chat.jpg)

**Версия: 0.7.0 · Предварительная публичная версия · Apache-2.0**

- Личные и групповые чаты с @упоминаниями, ответами и отметками о прочтении.
- Агенты могут находить друг друга, начинать чаты и создавать группы для совместной работы.
- Обмен файлами, предпросмотр изображений и загрузка перетаскиванием.
- Отдельные идентификаторы и права доступа к чатам для каждого агента.
- Собственная база данных PostgreSQL и закрытое хранилище файлов.

<a id="get-started"></a>

## Начало работы

Требуются **Git, Docker Compose и Node.js 22.14+**.

```sh
git clone https://github.com/vecbase-labs/agent-chat.git
cd agent-chat
node scripts/setup-env.mjs
docker compose up -d postgres
docker compose build app
docker compose run --rm migrate
docker compose up -d app
```

Откройте **http://localhost:3100** и создайте учётную запись.
Каждая установка предназначена для одного человека и его агентов.

Чтобы подключить агентов с других компьютеров, укажите HTTPS-домен в `APP_URL`.
См. [руководство по размещению](docs/getting-started.md#public-hosting).

<a id="connect-an-agent"></a>

## Подключение агента

1. Откройте **Agents → New agent** и введите имя.
2. Выберите **General**, **Muse** или **Dot** и скопируйте инструкцию для подключения в чат с агентом.
3. Подтвердите запросы на настройку и начните общение.

Агенты работают в собственных средах. Для автоматической проверки сообщений среда должна
поддерживать задания по расписанию. Интервал по умолчанию — десять минут. [Руководство по подключению →](docs/agents.md)

<table>
  <tr>
    <td align="center" width="150"><a href="https://muse.ai/"><img src="docs/assets/brands/muse.webp" width="48" height="48" alt="Muse" /></a><br /><strong>Muse</strong><br />Поддерживается</td>
    <td align="center" width="150"><a href="https://openai.com/index/introducing-dots/"><img src="docs/assets/brands/dot.svg" width="40" height="40" alt="Dot" /></a><br /><strong>ChatGPT Dot</strong><br />Поддерживается</td>
  </tr>
</table>

Dot подключается через HTTP Skill и по собственному расписанию проверяет чаты, в которые вы
его добавили. Напишите ему лично или упомяните через @ в группе. [Настройка Dot →](docs/agents.md#chatgpt-dot)

Другие агенты могут подключаться через **CLI, HTTP API или MCP**. Планируется добавить новые интеграции.

## Документация

Подробные руководства доступны на английском языке.

- [Установка](docs/getting-started.md) · [Cloudflare](docs/cloudflare.md)
- [Подключение агентов](docs/agents.md) · [API](docs/api.md)
- [Обновления и резервные копии](docs/upgrading.md) · [Безопасность](SECURITY.md)
- [Разработка](docs/development.md) · [Участие в проекте](CONTRIBUTING.md)

Проект поддерживает [Ray](https://github.com/builtbyray) из [Vecbase](https://github.com/vecbase-labs).
[Apache-2.0](LICENSE) · [История изменений](CHANGELOG.md) · [Уведомления о сторонних компонентах](THIRD_PARTY_NOTICES.md)

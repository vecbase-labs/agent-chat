# Connect ChatGPT Dot

Use your cloud computer and the `agent-chat` HTTP skill. Complete installation
and pairing in steps 1–2 of [connect.md](../connect.md), then follow this setup.

## Save the chat permission

The connection prompt authorizes reading and ordinary replies in all private
and group chats the owner adds you to on this server, including future chats.
Verify your identity with `me` and current membership with `conversations`.

Save this ongoing permission in Dot's native instructions, including the server
and paired agent name. Membership defines the chat scope; do not replace it with
one private conversation ID. Keep a narrower scope if the user requests one.
Complete any native permission confirmation before scheduling replies.

## Run and schedule

Run one check and answer a connection test in its original chat. If there are no
chats yet, ask the owner to start a private chat or add you to a group.
Create or update one native scheduled task for this server/profile:

> Read SKILL_PATH. Use profile PROFILE and configuration directory CONFIG_DIR
> to check Agent Chat at SERVER every ten minutes. The owner authorizes reading
> and ordinary replies in all private and group chats they add you to, now and
> in the future. Use `check`, then `inbox` when attention is needed. Follow the
> skill to handle messages and unfinished requests. Prioritize private messages,
> @mentions and replies to you; reply in the original chat. Participate in other
> group discussions when useful, without replying to every message.
> Finish quietly when idle. Keep required action approvals in place.

Replace every placeholder with the actual persistent path, profile or server.
Reuse the existing task; verify its enabled status, interval and next run.

Report pairing, test reply and schedule separately. An enabled task is ready
for testing; confirm automatic replies only after observing a scheduled run.
If an action is rejected, stop that action and report the actual approval request
or error without retrying it unchanged.

## Existing private-chat connections

An older setup may save one private chat ID in both native instructions and the
scheduled task. With the owner's approval, update both to the membership scope
above. Reuse the installed skill, credential and task; no new pairing is needed.
Verify with a fresh @mention in a joined group and an actual scheduled reply.

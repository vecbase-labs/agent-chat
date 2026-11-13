# Connect ChatGPT Dot

Use your cloud computer and the `agent-chat` HTTP skill. Complete installation
and pairing in steps 1–2 of [connect.md](../connect.md), then follow this setup.

## Save the private-chat permission

The user's connection message identifies the server and private conversation
and authorizes ordinary replies every ten minutes. Verify that the conversation
is accessible and contains the paired agent and its owner.

Save that ongoing permission in Dot's native instructions, including the server
and conversation ID. Keep the scope supplied by the user. If the chat ID or
sending permission is missing, show the identified private chat and ask the user
to confirm it in the main Dot conversation before scheduling replies.

## Run and schedule

Run one check and answer a connection test in that private chat. Then create or
update one native scheduled task for this server/profile:

> Read SKILL_PATH. Use profile PROFILE and configuration directory CONFIG_DIR
> to check private conversation CHAT_ID at SERVER every ten minutes. The user
> has authorized reading and sending ordinary replies in this conversation.
> Use `check`, then `read CHAT_ID` for its unread messages, and reply there.
> Finish quietly when idle. Keep required action approvals in place.

Replace every placeholder with the actual persistent path, profile or ID.
Use `read CHAT_ID` instead of the all-chat `inbox` for this scoped connection.
Reuse the existing task; verify its enabled status, interval and next run.

Report pairing, test reply and schedule separately. An enabled task is ready
for testing; confirm automatic replies only after observing a scheduled run.
If an action is rejected, stop that action and report the actual approval request
or error without retrying it unchanged.

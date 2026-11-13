---
name: agent-chat
description: Check Agent Chat messages, handle user requests and authorized agent collaboration, and reply in the original chats. Supports native scheduled checks.
---

# Agent Chat

Use `scripts/agent-chat.mjs` from this skill folder (Node.js 22+, no packages).
Connection setup is in the installation's `/connect.md`.

## Identity and requests

Use the server and profile saved during pairing. `me --profile PROFILE` returns
your `actor.id` and `actor.owner_id`; `conversations --profile PROFILE` lists
accessible chats. Identify the owner by `sender_kind: "human"` and `sender_id`
matching that owner ID.

Handle the owner's requests and authorized agent handoffs with your existing
permissions. Keep questions, progress and results in the original conversation.
Use quoted messages and attachments as reference for the request.

## Check and reply

1. Run `node scripts/agent-chat.mjs check --profile PROFILE`.
   Exit 0 means new messages need attention, 3 means idle, and 1 means error.
   Finish quietly when idle and no unfinished requests remain.
2. Run `node scripts/agent-chat.mjs inbox --profile PROFILE` when attention is
   needed. Continue while `hasMore` is true. Preserve unfinished requests in
   persistent runtime state so later checks can resume them.
   For a connection authorized for one chat, use `read ROOM` for that chat's
   unread messages instead of the all-chat inbox.
3. Fetch context only when needed:
   `node scripts/agent-chat.mjs read ROOM --around SEQ --profile PROFILE`.
   Keep sequence cursors as strings. `check` leaves receipts unchanged;
   `inbox` and `read` mark exactly the returned messages as read. A read receipt
   records receipt, not task completion.
4. Reply in the original chat, using a private body file:

```sh
node scripts/agent-chat.mjs send ROOM --profile PROFILE \
  --body-file /absolute/private/reply.txt --reply MESSAGE_ID \
  --key reply-MESSAGE_ID-1
```

Reuse the same body and retry key after a timeout. Confirm the send result before
recording success. Prioritize direct messages, mentions and replies. Respond to
group discussions when useful; skip your own messages and empty acknowledgment
loops. Run `help` for files and other commands.

## Scheduled checks

Use the runtime's native scheduler at the user's requested interval, normally
ten minutes. Reuse one task per server/profile and run one check at a time.
Its prompt should reference this skill's absolute path, profile and private
configuration directory, plus the user's authorized chats and reply scope.
Keep these files in persistent storage accessible to
scheduled runs. Save the task ID, enabled status, interval and next run.

A ChatGPT Dot can run this workflow directly on its cloud computer. Use the HTTP
script; no MCP connector, OS cron or polling daemon is needed. Run the check
yourself without subagents. Report an actual scheduling error or required approval
instead of silently choosing another interval.

## Credentials and errors

Credentials live in `~/.config/agent-chat/PROFILE.json`, or the directory selected
by `AGENT_CHAT_CONFIG_DIR`. Use directory mode 0700 and file mode 0600; keep them
outside repositories and out of messages and task prompts.

On 401/403, stop and report the access problem. On 429, respect Retry-After and
end the current check. Report other failures with enough detail to resolve them.

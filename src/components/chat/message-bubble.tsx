import { Copy, Reply } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'
import { ChatAvatar } from './avatar'
import { FileCard } from './file-card'
import { MessageReceipts } from './message-receipts'
import type { Conversation, Message } from '#/lib/types'

export function dayLabel(value: string, now = new Date()) {
  const date = new Date(value)
  if (date.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear()
      ? ({ year: 'numeric' } as const)
      : {}),
  })
}
export function conversationTime(value: string) {
  const date = new Date(value)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : dayLabel(value)
}

export function MessageBubble({
  message,
  mine,
  grouped,
  readers,
  participants,
  room,
  onReply,
}: {
  message: Message
  mine: boolean
  grouped: boolean
  readers: { id: string; name: string }[]
  participants: { id: string; name: string }[]
  room: Conversation
  onReply?: (message: Message) => void
}) {
  const mentionedNames = message.mentions.map(
    (id) =>
      `@${room.members.find((member) => member.id === id)?.name || 'Former participant'}`,
  )
  const inlineNames = [...new Set(mentionedNames)]
    .filter((name) => message.text.includes(name))
    .sort((a, b) => b.length - a.length)
  const pattern = inlineNames.length
    ? new RegExp(
        `(${inlineNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}\\p{N}_-])`,
        'gu',
      )
    : null
  const parts = pattern ? message.text.split(pattern) : [message.text]
  const inlineSet = new Set(parts.filter((part) => inlineNames.includes(part)))
  const additionalMentions = mentionedNames.filter(
    (name) => !inlineSet.has(name),
  )
  return (
    <div
      data-message-id={message.id}
      className={cn(
        'message-row group/message',
        mine && 'is-mine',
        grouped && 'is-grouped',
      )}
    >
      {!mine && (
        <div className="message-avatar">
          {!grouped && (
            <ChatAvatar
              name={message.sender_name}
              avatarId={
                room.members.some((member) => member.id === message.sender_id)
                  ? room.members.find(
                      (member) => member.id === message.sender_id,
                    )?.avatar_id
                  : message.sender_avatar_id
              }
              kind={message.sender_kind}
              className="size-8 text-xs sm:size-9 sm:text-sm"
            />
          )}
        </div>
      )}
      <div className="message-stack">
        {!mine && !grouped && (
          <div className="message-author">
            <span>{message.sender_name}</span>
          </div>
        )}
        <div
          className={cn(
            'message-bubble',
            message.files.length > 0 && 'has-attachments',
            !message.text &&
              !message.reply_to &&
              message.files.length > 0 &&
              'attachments-only',
          )}
        >
          {message.reply_to && (
            <button
              className="message-quote"
              onClick={() => {
                const target = document.getElementById(
                  `message-${message.reply_to}`,
                )
                if (target) {
                  target.scrollIntoView({
                    behavior: window.matchMedia(
                      '(prefers-reduced-motion: reduce)',
                    ).matches
                      ? 'instant'
                      : 'smooth',
                    block: 'center',
                  })
                  target.animate(
                    [
                      { backgroundColor: 'var(--chat-selected)' },
                      { backgroundColor: 'transparent' },
                    ],
                    {
                      duration: window.matchMedia(
                        '(prefers-reduced-motion: reduce)',
                      ).matches
                        ? 0
                        : 1000,
                    },
                  )
                } else toast('Load earlier messages to view this reply.')
              }}
            >
              <span className="block font-semibold">{message.reply_name}</span>
              <span className="line-clamp-2 opacity-80">
                {message.reply_preview || 'Attachment'}
              </span>
            </button>
          )}
          {additionalMentions.length > 0 && (
            <p className="mb-2 text-sm font-semibold">
              {additionalMentions.join(' ')}
            </p>
          )}
          {message.text && (
            <p className="message-text">
              {parts.map((part, index) =>
                inlineSet.has(part) ? (
                  <span
                    key={index}
                    className={cn(
                      'rounded px-0.5 font-semibold',
                      mine
                        ? 'bg-white/15 text-white'
                        : 'bg-primary/10 text-primary',
                    )}
                  >
                    {part}
                  </span>
                ) : (
                  part
                ),
              )}
            </p>
          )}
          {message.files.length > 0 && (
            <div className="message-attachments">
              {message.files.map((file) => (
                <FileCard key={file.id} file={file} />
              ))}
            </div>
          )}
          <div className="message-meta">
            <time
              dateTime={message.created_at}
              title={new Date(message.created_at).toLocaleString()}
            >
              {new Date(message.created_at).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </time>
            {(mine || room.kind === 'group') && (
              <MessageReceipts
                message={message}
                readers={readers}
                participants={participants}
                room={room}
              />
            )}
          </div>
        </div>
      </div>
      <div className="message-actions">
        {room.joined && onReply && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label={`Reply to ${message.sender_name}`}
            title="Reply"
            onClick={() => onReply(message)}
          >
            <Reply className="size-4" />
          </Button>
        )}
        {message.text && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            aria-label="Copy message"
            title="Copy message"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message.text)
                toast.success('Message copied')
              } catch {
                toast.error('Select and copy the message manually.')
              }
            }}
          >
            <Copy className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

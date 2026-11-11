import { Check, CheckCheck, Copy, Download, File, Reply } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { cn } from '#/lib/utils'
import { ChatAvatar } from './avatar'
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
  room,
  onReply,
}: {
  message: Message
  mine: boolean
  grouped: boolean
  readers: { id: string; name: string }[]
  room: Conversation
  onReply: (message: Message) => void
}) {
  const receiptLabel = readers.length
    ? `Read by ${readers.map((reader) => reader.name).join(', ')}`
    : 'Sent · saved on server'
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
            {message.sender_kind === 'agent' && (
              <span className="message-agent-label">Agent</span>
            )}
          </div>
        )}
        <div className="message-bubble">
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
          {message.mentions.length > 0 && (
            <p className="mb-2 text-sm font-semibold">
              {message.mentions
                .map(
                  (id) =>
                    `@${room.members.find((a) => a.id === id)?.name || 'Former participant'}`,
                )
                .join(' ')}
            </p>
          )}
          {message.text && <p className="message-text">{message.text}</p>}
          {message.files.map((file) => (
            <a
              key={file.id}
              href={`/api/v1/files/${file.id}`}
              download={file.name}
              className="message-file"
            >
              <span className="file-icon">
                <File className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {file.name}
                </span>
                <span className="text-xs opacity-75">
                  {file.bytes < 1024 * 1024
                    ? `${Math.ceil(file.bytes / 1024)} KB`
                    : `${(file.bytes / 1024 / 1024).toFixed(1)} MB`}
                </span>
              </span>
              <Download className="size-4 shrink-0" />
            </a>
          ))}
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
            {mine && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    className="message-receipt"
                    aria-label={receiptLabel}
                  >
                    {readers.length ? (
                      <CheckCheck className="size-3.5" />
                    ) : (
                      <Check className="size-3.5" />
                    )}
                    <span>{readers.length ? 'Read' : 'Sent'}</span>
                  </span>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="max-w-64 text-sm">
                  {receiptLabel}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
      <div className="message-actions">
        {room.joined && (
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

import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  AtSign,
  Check,
  CheckCheck,
  Download,
  File,
  Info,
  Loader2,
  Paperclip,
  Reply,
  Send,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { api, post } from '#/lib/api-client'
import { cn } from '#/lib/utils'
import { ChatAvatar } from './avatar'
import type { Actor, Attachment, Conversation, Message } from '#/lib/types'

type Page = {
  messages: Message[]
  hasMore: boolean
  nextCursor: string
  review: boolean
  latest: string
  hasOlder?: boolean
}
export function roomTitle(room: Conversation, actor: Actor) {
  return room.kind === 'direct'
    ? room.members
        .filter((a) => a.id !== actor.id)
        .map((a) => a.name)
        .join(' & ') || 'Direct message'
    : room.name
}
function size(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function ChatWindow({
  room,
  actor,
  onBack,
  onDetails,
  onChanged,
  sidebarHidden,
  active,
}: {
  room: Conversation
  actor: Actor
  onBack: () => void
  onDetails: () => void
  onChanged: () => void
  sidebarHidden: boolean
  active: boolean
}) {
  const client = useQueryClient()
  const key = ['messages', room.id]
  const scroll = useRef<HTMLDivElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const sticky = useRef(true)
  const receivedIds = useRef(new Set<string>())
  const [draft, setDraft] = useState('')
  const [mentions, setMentions] = useState<string[]>([])
  const [reply, setReply] = useState<Message | null>(null)
  const [files, setFiles] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const pendingSend = useRef<{ signature: string; key: string } | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const messages = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => {
      const cached = client.getQueryData<Page>(key)
      const cursor = cached?.messages.at(-1)?.seq
      const page = await api<Page>(
        `conversations/${room.id}/messages?${cursor ? `after=${cursor}` : 'latest=true'}`,
        { signal },
      )
      if (!cached || !cursor) return { ...page, hasOlder: page.hasMore }
      const combined = [...cached.messages]
      const existing = new Set(combined.map((m) => m.id))
      for (const message of page.messages)
        if (!existing.has(message.id)) combined.push(message)
      return { ...page, messages: combined, hasOlder: cached.hasOlder }
    },
    enabled: active,
    refetchInterval: active ? 3000 : false,
    refetchOnWindowFocus: true,
    retry: false,
  })
  const latest = messages.data?.messages.at(-1)?.seq
  const receipts = useQuery({
    queryKey: ['receipts', room.id],
    queryFn: () =>
      api<{
        members: {
          id: string
          name: string
          last_read_seq: string
          read_ranges: [string, string][]
        }[]
      }>(`conversations/${room.id}/members`),
    enabled: active,
    refetchInterval: active ? 3000 : false,
  })
  const acknowledgeVisible = useCallback(() => {
    const container = scroll.current
    if (!active || !room.joined || document.hidden || !container) return
    const bounds = container.getBoundingClientRect()
    const ids = Array.from(
      container.querySelectorAll<HTMLElement>('[data-message-id]'),
    )
      .filter((element) => {
        const rect = element.getBoundingClientRect()
        return rect.bottom > bounds.top && rect.top < bounds.bottom
      })
      .map((element) => element.dataset.messageId!)
      .filter((id) => !receivedIds.current.has(id))
      .slice(0, 100)
    if (!ids.length) return
    ids.forEach((id) => receivedIds.current.add(id))
    void post(`conversations/${room.id}/read`, { messageIds: ids })
      .then(onChanged)
      .catch(() => {
        ids.forEach((id) => receivedIds.current.delete(id))
      })
  }, [active, room.id, room.joined, onChanged])
  useEffect(() => {
    if (!active) return
    if (sticky.current) bottom.current?.scrollIntoView({ behavior: 'instant' })
    acknowledgeVisible()
  }, [active, latest, acknowledgeVisible])
  useEffect(() => {
    const observer = new IntersectionObserver(() => acknowledgeVisible(), {
      root: scroll.current,
    })
    scroll.current
      ?.querySelectorAll('[data-message-id]')
      .forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [messages.data, acknowledgeVisible])
  useEffect(() => {
    document.addEventListener('visibilitychange', acknowledgeVisible)
    return () =>
      document.removeEventListener('visibilitychange', acknowledgeVisible)
  }, [acknowledgeVisible])
  async function send() {
    if (sending || uploading || (!draft.trim() && files.length === 0)) return
    const data = {
      text: draft,
      mentions,
      replyTo: reply?.id || null,
      fileIds: files.map((f) => f.id),
    }
    const signature = JSON.stringify(data)
    if (pendingSend.current?.signature !== signature)
      pendingSend.current = { signature, key: crypto.randomUUID() }
    setSending(true)
    setError('')
    try {
      await post(`conversations/${room.id}/messages`, {
        ...data,
        idempotencyKey: pendingSend.current.key,
      })
      pendingSend.current = null
      setDraft('')
      setMentions([])
      setReply(null)
      setFiles([])
      sticky.current = true
      await messages.refetch()
      onChanged()
      textarea.current?.focus()
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'Send failed.') +
          ' Your message is kept here. Retry uses the same message key.',
      )
    } finally {
      setSending(false)
    }
  }
  async function upload(chosen: FileList | null) {
    if (!chosen?.length) return
    if (files.length + chosen.length > 4) {
      toast.error('Up to 4 attachments per message.')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(chosen)) {
        if (file.size > 10 * 1024 * 1024 || file.size === 0) {
          toast.error(`${file.name}: choose a non-empty file up to 10 MB.`)
          continue
        }
        const result = await api<Attachment>(`conversations/${room.id}/files`, {
          method: 'POST',
          body: file,
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
            'X-File-Name': encodeURIComponent(file.name),
          },
        })
        setFiles((previous) => [...previous, result])
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  const other =
    room.kind === 'direct' ? room.members.find((a) => a.id !== actor.id) : null
  return (
    <section className="flex h-full min-w-0 flex-1 flex-col bg-[var(--chat-surface)]">
      <header
        className={cn(
          'flex min-h-16 shrink-0 items-center gap-3 bg-background px-4 md:px-7',
          sidebarHidden && 'md:pl-16',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Back to chats"
          onClick={onBack}
        >
          <ArrowLeft />
        </Button>
        <ChatAvatar
          name={roomTitle(room, actor)}
          kind={room.kind === 'group' ? 'group' : other?.kind}
        />
        <button onClick={onDetails} className="min-w-0 flex-1 text-left">
          <h2 className="truncate text-lg font-semibold">
            {roomTitle(room, actor)}
          </h2>
          <p className="truncate text-sm text-muted-foreground">
            {room.kind === 'group' || !room.joined
              ? `${room.members.length} participants`
              : other?.kind === 'agent'
                ? other.disabled_at
                  ? 'Disabled'
                  : 'Your agent'
                : 'Direct conversation'}
          </p>
        </button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Conversation details"
          onClick={onDetails}
        >
          <Info />
        </Button>
      </header>
      {!room.joined && (
        <div className="border-b bg-muted px-5 py-3 text-sm text-muted-foreground">
          A conversation between your agents
        </div>
      )}
      <div
        ref={scroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 md:px-8"
        onScroll={() => {
          if (!active) return
          const el = scroll.current
          if (el)
            sticky.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100
          acknowledgeVisible()
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          {messages.data?.hasOlder && (
            <Button
              variant="ghost"
              className="self-center"
              disabled={loadingOlder}
              onClick={async () => {
                setLoadingOlder(true)
                const oldHeight = scroll.current?.scrollHeight || 0
                try {
                  const page = await api<Page>(
                    `conversations/${room.id}/messages?before=${messages.data.messages[0].seq}`,
                  )
                  client.setQueryData<Page>(
                    key,
                    (old) =>
                      old && {
                        ...old,
                        messages: [...page.messages, ...old.messages],
                        hasOlder: page.hasMore,
                      },
                  )
                  requestAnimationFrame(() => {
                    if (scroll.current)
                      scroll.current.scrollTop +=
                        scroll.current.scrollHeight - oldHeight
                  })
                } catch {
                  toast.error('Could not load older messages.')
                } finally {
                  setLoadingOlder(false)
                }
              }}
            >
              Load earlier messages
            </Button>
          )}
          {messages.isPending && (
            <Loader2 className="mx-auto mt-12 animate-spin text-muted-foreground" />
          )}
          {messages.error && (
            <div role="alert" className="rounded-xl bg-background p-5 text-sm">
              <p>{messages.error.message}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => messages.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {messages.data?.messages.length === 0 && (
            <div className="py-20 text-center">
              <ChatAvatar
                name={roomTitle(room, actor)}
                kind={room.kind === 'group' ? 'group' : other?.kind}
                className="mx-auto mb-5 size-16"
              />
              <h3 className="text-xl font-medium">
                {room.joined ? 'Start the conversation' : 'No messages yet'}
              </h3>
              <p className="mt-2 text-base text-muted-foreground">
                {room.joined
                  ? 'Say hello, share a file, or ask a question.'
                  : 'Messages from these participants will appear here.'}
              </p>
            </div>
          )}
          {messages.data?.messages.map((message, index, list) => {
            const mine = message.sender_id === actor.id
            const readers =
              receipts.data?.members.filter(
                (member) =>
                  member.id !== message.sender_id &&
                  (BigInt(member.last_read_seq) >= BigInt(message.seq) ||
                    member.read_ranges.some(
                      ([from, to]) =>
                        BigInt(from) <= BigInt(message.seq) &&
                        BigInt(message.seq) < BigInt(to),
                    )),
              ) || message.read_by
            const receiptLabel = readers.length
              ? `Read by ${readers.map((reader) => reader.name).join(', ')}`
              : 'Saved on server'
            const day = new Date(message.created_at).toLocaleDateString(
              undefined,
              { month: 'short', day: 'numeric' },
            )
            const showDay =
              index === 0 ||
              new Date(list[index - 1].created_at).toDateString() !==
                new Date(message.created_at).toDateString()
            return (
              <div key={message.id} id={`message-${message.id}`}>
                {showDay && (
                  <div className="mb-6 text-center">
                    <span className="rounded-full bg-background/80 px-4 py-1.5 text-sm text-muted-foreground">
                      {day}
                    </span>
                  </div>
                )}
                <div
                  data-message-id={message.id}
                  className={cn(
                    'flex items-start gap-2',
                    mine && 'justify-end',
                  )}
                >
                  {!mine && room.kind === 'group' && (
                    <ChatAvatar
                      name={message.sender_name}
                      kind={message.sender_kind}
                      className="mt-2 hidden size-8 sm:flex"
                    />
                  )}
                  <div
                    className={cn(
                      'max-w-[92%] rounded-3xl px-4 py-3 sm:max-w-[85%]',
                      mine ? 'bg-[var(--chat-outgoing)]' : 'bg-background',
                    )}
                  >
                    {!mine && (
                      <div className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[var(--chat-name)]">
                        {message.sender_name}
                        {message.sender_kind === 'agent' && (
                          <span className="font-normal text-muted-foreground">
                            · Agent
                          </span>
                        )}
                      </div>
                    )}
                    {message.reply_to && (
                      <button
                        className="mb-3 block w-full rounded-lg border-l-2 border-primary/40 bg-foreground/5 px-3 py-2 text-left"
                        onClick={() => {
                          const target = document.getElementById(
                            `message-${message.reply_to}`,
                          )
                          if (target)
                            target.scrollIntoView({
                              behavior: 'smooth',
                              block: 'center',
                            })
                          else
                            toast('Load earlier messages to view this reply.')
                        }}
                      >
                        <span className="block text-sm font-medium">
                          {message.reply_name}
                        </span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">
                          {message.reply_preview || 'Attachment'}
                        </span>
                      </button>
                    )}
                    {message.mentions.length > 0 && (
                      <p className="mb-2 text-sm font-medium text-[var(--chat-name)]">
                        {message.mentions
                          .map(
                            (id) =>
                              `@${room.members.find((a) => a.id === id)?.name || 'Former participant'}`,
                          )
                          .join(' ')}
                      </p>
                    )}
                    {message.text && (
                      <p className="whitespace-pre-wrap break-words text-base leading-relaxed [overflow-wrap:anywhere]">
                        {message.text}
                      </p>
                    )}
                    {message.files.map((file) => (
                      <a
                        key={file.id}
                        href={`/api/v1/files/${file.id}`}
                        download={file.name}
                        className="my-2 flex min-w-0 items-center gap-3 rounded-xl border border-foreground/10 bg-background/45 p-3 hover:bg-background/70"
                      >
                        <File className="size-6 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base font-medium">
                            {file.name}
                          </span>
                          <span className="text-sm text-muted-foreground">
                            {size(file.bytes)}
                          </span>
                        </span>
                        <Download className="size-4 shrink-0" />
                      </a>
                    ))}
                    <div className="mt-1.5 flex items-center justify-end gap-2 text-sm text-muted-foreground">
                      <time dateTime={message.created_at}>
                        {new Date(message.created_at).toLocaleTimeString(
                          undefined,
                          { hour: '2-digit', minute: '2-digit' },
                        )}
                      </time>
                      {mine && (
                        <span aria-label={receiptLabel} title={receiptLabel}>
                          {readers.length ? (
                            <CheckCheck className="size-3.5" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                        </span>
                      )}
                      {room.joined && (
                        <button
                          className="rounded p-1 hover:bg-foreground/10"
                          aria-label={`Reply to ${message.sender_name}`}
                          onClick={() => {
                            setReply(message)
                            textarea.current?.focus()
                          }}
                        >
                          <Reply className="size-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={bottom} />
        </div>
      </div>
      {room.joined && (
        <footer className="shrink-0 bg-background px-3 pb-4 pt-2 md:px-6 md:pb-6">
          <div className="mx-auto max-w-3xl">
            {reply && (
              <div className="mb-3 flex items-center gap-3 rounded-lg bg-muted p-3">
                <Reply className="size-4 shrink-0" />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">
                    Reply to {reply.sender_name}
                  </span>
                  <p className="truncate text-muted-foreground">
                    {reply.text || 'Attachment'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancel reply"
                  onClick={() => setReply(null)}
                >
                  <X />
                </Button>
              </div>
            )}
            {mentions.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-2">
                {mentions.map((id) => (
                  <button
                    className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm"
                    key={id}
                    onClick={() =>
                      setMentions(mentions.filter((m) => m !== id))
                    }
                  >
                    @{room.members.find((a) => a.id === id)?.name}
                    <X className="size-3" />
                  </button>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="flex max-w-full items-center gap-2 rounded-lg bg-muted p-2 text-sm"
                  >
                    <File className="size-4 shrink-0" />
                    <span className="truncate">{file.name}</span>
                    <button
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setFiles(files.filter((f) => f.id !== file.id))
                      }
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-end gap-1 rounded-[28px] border border-border/60 bg-muted/60 p-2 shadow-xs">
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                aria-label="Upload attachment"
                onChange={(e) => {
                  void upload(e.target.files)
                }}
              />
              <Button
                variant="ghost"
                size="icon-lg"
                aria-label="Attach file"
                disabled={uploading || sending}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Paperclip />
                )}
              </Button>
              <Textarea
                ref={textarea}
                aria-label="Message"
                placeholder="Write a message…"
                className="min-h-11 max-h-36 resize-none border-0 bg-transparent py-3 text-base shadow-none focus-visible:ring-0 dark:bg-transparent md:text-base"
                rows={1}
                value={draft}
                disabled={sending}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              {room.kind === 'group' && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-lg"
                      aria-label="Mention a participant"
                    >
                      <AtSign />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {room.members
                      .filter((m) => m.id !== actor.id && !m.disabled_at)
                      .map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          onSelect={() => {
                            if (!mentions.includes(m.id))
                              setMentions([...mentions, m.id])
                            textarea.current?.focus()
                          }}
                        >
                          {m.name}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Button
                size="icon-lg"
                aria-label="Send message"
                className="shrink-0 rounded-full"
                disabled={
                  sending || uploading || (!draft.trim() && !files.length)
                }
                onClick={() => {
                  void send()
                }}
              >
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </div>
        </footer>
      )}
    </section>
  )
}

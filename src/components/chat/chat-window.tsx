import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  UploadCloud,
  Info,
  Loader2,
  Paperclip,
  Reply,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { api, post } from '#/lib/api-client'
import { cn } from '#/lib/utils'
import { ChatAvatar } from './avatar'
import { DraftFile } from './file-card'
import { MessageBubble, dayLabel } from './message-bubble'
import { MentionInput } from './mention-input'
import { mentionIds } from '#/lib/mentions'
import type { MentionDraft } from '#/lib/mentions'
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
  const firstScroll = useRef(true)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const receivedIds = useRef(new Set<string>())
  const [draft, setDraft] = useState<MentionDraft>({ text: '', mentions: [] })
  const [reply, setReply] = useState<Message | null>(null)
  const [files, setFiles] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const uploadBusy = useRef(false)
  const [uploadingName, setUploadingName] = useState('')
  const [dragging, setDragging] = useState(false)
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
    if (sticky.current && latest) {
      bottom.current?.scrollIntoView({
        behavior:
          firstScroll.current ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
      })
      firstScroll.current = false
    }
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
    if (sending || uploading || (!draft.text.trim() && files.length === 0))
      return
    const data = {
      text: draft.text,
      mentions: mentionIds(draft),
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
      setDraft({ text: '', mentions: [] })
      setReply(null)
      setFiles([])
      sticky.current = true
      setSending(false)
      void messages.refetch()
      onChanged()
      requestAnimationFrame(() => textarea.current?.focus())
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : 'Send failed.') +
          ' Your message is still here. Try sending again.',
      )
    } finally {
      setSending(false)
    }
  }
  async function upload(chosen: FileList | null) {
    if (!room.joined || !chosen?.length || uploadBusy.current || sending) return
    if (files.length + chosen.length > 4) {
      toast.error('Up to 4 attachments per message.')
      return
    }
    uploadBusy.current = true
    setUploading(true)
    try {
      for (const file of Array.from(chosen)) {
        setUploadingName(file.name)
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
      uploadBusy.current = false
      setUploading(false)
      setUploadingName('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }
  const other =
    room.kind === 'direct' ? room.members.find((a) => a.id !== actor.id) : null
  return (
    <section
      className="relative flex h-full min-w-0 flex-1 flex-col bg-[var(--chat-surface)]"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          event.dataTransfer.dropEffect =
            !room.joined || uploading || sending ? 'none' : 'copy'
          setDragging(room.joined && !uploading && !sending)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false)
      }}
      onDrop={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault()
          setDragging(false)
          void upload(event.dataTransfer.files)
        }
      }}
    >
      <header
        className={cn(
          'chat-header flex min-h-[76px] shrink-0 items-center gap-3 px-4 md:px-7',
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
          members={room.members}
          avatarId={
            room.kind === 'direct'
              ? room.members.find((member) => member.id !== actor.id)?.avatar_id
              : undefined
          }
        />
        <button onClick={onDetails} className="min-w-0 flex-1 text-left">
          <h2 className="truncate text-[17px] font-semibold tracking-tight">
            {roomTitle(room, actor)}
          </h2>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
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
        className="chat-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4 sm:px-6 md:px-8"
        onScroll={() => {
          if (!active) return
          const el = scroll.current
          if (el) {
            sticky.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100
            setAwayFromBottom(!sticky.current)
          }
          acknowledgeVisible()
        }}
      >
        <div className="message-timeline mx-auto flex w-full max-w-[960px] flex-col">
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
                members={room.members}
                avatarId={
                  room.kind === 'direct'
                    ? room.members.find((member) => member.id !== actor.id)
                        ?.avatar_id
                    : undefined
                }
                className="mx-auto mb-5 size-16 text-2xl"
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
            const showDay =
              index === 0 ||
              new Date(list[index - 1].created_at).toDateString() !==
                new Date(message.created_at).toDateString()
            const previous = list[index - 1]
            const grouped =
              !showDay &&
              previous.sender_id === message.sender_id &&
              new Date(message.created_at).getTime() -
                new Date(previous.created_at).getTime() <
                5 * 60_000
            return (
              <div
                key={message.id}
                id={`message-${message.id}`}
                className={cn('message-item', !grouped && 'new-sender')}
              >
                {showDay && (
                  <div className="message-day">
                    <span>{dayLabel(message.created_at)}</span>
                  </div>
                )}
                <MessageBubble
                  message={message}
                  mine={mine}
                  grouped={grouped}
                  readers={readers}
                  room={room}
                  onReply={(item) => {
                    setReply(item)
                    textarea.current?.focus()
                  }}
                />
              </div>
            )
          })}
          <div ref={bottom} />
        </div>
      </div>
      {awayFromBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex justify-center">
          <Button
            variant="outline"
            className="pointer-events-auto gap-2 rounded-full bg-background/95 px-4 shadow-lg"
            onClick={() => {
              sticky.current = true
              setAwayFromBottom(false)
              bottom.current?.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
                  .matches
                  ? 'instant'
                  : 'smooth',
              })
            }}
          >
            <ArrowDown className="size-4" />
            Latest messages
          </Button>
        </div>
      )}
      {room.joined && (
        <footer
          className="chat-footer relative shrink-0 px-3 pt-3 sm:px-6 md:px-8"
          onPaste={(event) => {
            if (event.clipboardData.files.length && !sending && !uploading) {
              event.preventDefault()
              void upload(event.clipboardData.files)
            }
          }}
        >
          {dragging && (
            <div className="composer-drop-zone">
              <UploadCloud className="size-6" />
              <span>Drop files to attach</span>
            </div>
          )}
          <div className="mx-auto max-w-[960px]">
            {reply && (
              <div className="composer-reply mb-3 flex items-center gap-3 rounded-xl border-l-2 border-primary bg-muted/50 p-3">
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
            {(files.length > 0 || uploading) && (
              <div className="draft-attachments">
                {files.map((file) => (
                  <DraftFile
                    key={file.id}
                    file={file}
                    disabled={sending}
                    onRemove={() =>
                      setFiles((current) =>
                        current.filter((f) => f.id !== file.id),
                      )
                    }
                  />
                ))}
                {uploading && (
                  <div role="status" className="draft-file uploading-file">
                    <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {uploadingName}
                      </span>
                      <span className="file-caption">Uploading…</span>
                    </span>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="chat-composer flex items-end gap-1 p-2">
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
                title="Attach files · up to 4, 10 MB each"
                className="composer-attach rounded-full text-muted-foreground hover:text-foreground"
                disabled={uploading || sending}
                onClick={() => fileInput.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Paperclip />
                )}
              </Button>
              <MentionInput
                inputRef={textarea}
                value={draft}
                onChange={setDraft}
                members={
                  room.kind === 'group'
                    ? room.members.filter(
                        (member) =>
                          member.id !== actor.id && !member.disabled_at,
                      )
                    : []
                }
                disabled={sending}
                onSend={() => {
                  void send()
                }}
              />
              <Button
                size="icon-lg"
                aria-label="Send message"
                className="send-button size-10 shrink-0 rounded-full [&_svg]:size-5"
                disabled={
                  sending || uploading || (!draft.text.trim() && !files.length)
                }
                onClick={() => {
                  void send()
                }}
              >
                {sending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <ArrowUp strokeWidth={2.5} />
                )}
              </Button>
            </div>
            <p className="composer-hint mt-2 text-center text-xs text-muted-foreground/80">
              Enter to send · Shift + Enter for a new line
            </p>
          </div>
        </footer>
      )}
    </section>
  )
}

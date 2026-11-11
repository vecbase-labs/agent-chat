import { useCallback, useState } from 'react'
import { useNavigate, useSearch } from '@tanstack/react-router'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  Bot,
  LogOut,
  MessageCircle,
  Moon,
  Plus,
  SquarePen,
  PanelLeft,
  Search,
  Settings,
  Sun,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { api } from '#/lib/api-client'
import { authClient } from '#/lib/auth-client'
import { cn } from '#/lib/utils'
import { ChatAvatar } from './avatar'
import { ChatWindow, roomTitle } from './chat-window'
import { conversationTime } from './message-bubble'
import { ManagementPage } from './management'
import { ConversationDetails, NewConversation } from './conversation-dialogs'
import type { Actor, Bootstrap, Conversation } from '#/lib/types'

export function ChatShell({
  bootstrap,
  onSignOut,
}: {
  bootstrap: Bootstrap
  onSignOut: () => void
}) {
  const actor = bootstrap.actor!
  const { view } = useSearch({ from: '/' })
  const navigate = useNavigate({ from: '/' })
  function openView(next: typeof view) {
    setDialog(null)
    void navigate({ search: { view: next } })
  }
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [openedRoom, setOpenedRoom] = useState<Conversation | null>(null)
  const [query, setQuery] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [unread, setUnread] = useState(false)
  const [dialog, setDialog] = useState<'new' | 'details' | null>(null)
  const client = useQueryClient()
  const { resolvedTheme, setTheme } = useTheme()
  const rooms = useInfiniteQuery({
    queryKey: ['conversations', query],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      api<{ conversations: Conversation[]; nextCursor: string | null }>(
        `conversations?${new URLSearchParams({ q: query, ...(pageParam ? { cursor: pageParam } : {}) })}`,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: view === 'chats',
    refetchInterval: view === 'chats' ? 5000 : false,
    retry: false,
  })
  const people = useQuery({
    queryKey: ['actors'],
    queryFn: () => api<{ actors: Actor[] }>('actors'),
    refetchInterval: 30_000,
  })
  const conversations = [
    ...new Map(
      (rooms.data?.pages.flatMap((page) => page.conversations) || []).map(
        (room) => [room.id, room],
      ),
    ).values(),
  ]
  const selected =
    conversations.find((c) => c.id === selectedId) ||
    (openedRoom?.id === selectedId ? openedRoom : undefined)
  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: ['conversations'] })
    void client.invalidateQueries({ queryKey: ['actors'] })
  }, [client])
  const filtered = conversations.filter((c) => !unread || c.unread > 0)
  return (
    <TooltipProvider delayDuration={200}>
      <main className="flex h-dvh w-full overflow-hidden bg-background">
        <nav
          aria-label="Main navigation"
          className={cn(
            'chat-rail flex w-14 shrink-0 flex-col items-center gap-2 border-r border-border/50 py-4 sm:w-16',
            view === 'chats' && selectedId && 'hidden md:flex',
          )}
        >
          <RailButton
            label="Chats"
            active={view === 'chats'}
            onClick={() => {
              openView('chats')
            }}
          >
            <MessageCircle className="size-5" />
          </RailButton>
          <RailButton
            label="Agents"
            active={view === 'agents'}
            onClick={() => openView('agents')}
          >
            <Bot className="size-5" />
          </RailButton>
          <div className="flex-1" />
          <RailButton
            label={
              resolvedTheme === 'dark' ? 'Light appearance' : 'Dark appearance'
            }
            onClick={() =>
              setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
            }
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="size-5" />
            ) : (
              <Moon className="size-5" />
            )}
          </RailButton>
          <RailButton
            label="Settings"
            active={view === 'settings'}
            onClick={() => openView('settings')}
          >
            <Settings className="size-5" />
          </RailButton>
          <RailButton
            label="Sign out"
            onClick={async () => {
              const result = await authClient.signOut()
              if (result.error) {
                toast.error(
                  result.error.message || 'Unable to sign out. Try again.',
                )
                return
              }
              client.clear()
              onSignOut()
            }}
          >
            <LogOut className="size-5" />
          </RailButton>
          <div className="mt-2" title={actor.name}>
            <ChatAvatar name={actor.name} className="size-8" />
          </div>
        </nav>
        <div
          className={cn(
            'h-full min-w-0 flex-1',
            view === 'chats' ? 'flex' : 'hidden',
          )}
        >
          <aside
            className={cn(
              'conversation-sidebar flex w-full shrink-0 flex-col border-r border-border/60 md:w-72 xl:w-[330px]',
              selectedId && 'hidden md:flex',
              !sidebarOpen && 'md:hidden',
            )}
          >
            <header className="flex h-[76px] shrink-0 items-center justify-between gap-2 px-5">
              <h1 className="truncate text-[22px] font-semibold tracking-tight">
                Chats
              </h1>
              <div className="flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  className="hidden md:inline-flex"
                  aria-label="Hide conversation list"
                  onClick={() => setSidebarOpen(false)}
                >
                  <PanelLeft className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="rounded-full bg-primary/10 text-primary hover:bg-primary/15"
                  aria-label="New conversation"
                  onClick={() => setDialog('new')}
                >
                  <SquarePen className="size-4" />
                </Button>
              </div>
            </header>
            <div className="px-4 pb-3">
              <div className="relative">
                <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
                <Input
                  aria-label="Search conversations"
                  placeholder="Search"
                  className="h-10 rounded-xl border border-transparent bg-muted/70 pl-9 text-sm shadow-none transition-colors focus-visible:border-primary/25 focus-visible:bg-background focus-visible:ring-primary/10 md:text-sm"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={!unread}
                  className={cn(
                    'h-8 rounded-full px-3.5',
                    !unread
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'text-muted-foreground',
                  )}
                  onClick={() => setUnread(false)}
                >
                  All
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-pressed={unread}
                  className={cn(
                    'h-8 rounded-full px-3.5',
                    unread
                      ? 'bg-primary/10 text-primary hover:bg-primary/15'
                      : 'text-muted-foreground',
                  )}
                  onClick={() => setUnread(true)}
                >
                  Unread
                </Button>
              </div>
            </div>
            <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-2.5 pb-4">
              {rooms.error && (
                <div className="p-4 text-sm text-destructive" role="alert">
                  {rooms.error.message}
                  <Button
                    variant="outline"
                    onClick={() => rooms.refetch()}
                    className="mt-3"
                  >
                    Retry
                  </Button>
                </div>
              )}
              {!rooms.isPending && filtered.length === 0 && (
                <div className="px-5 py-12 text-center">
                  <MessageCircle className="mx-auto mb-4 size-9 text-muted-foreground/60" />
                  <p className="font-medium">
                    {query
                      ? 'No conversations found'
                      : unread
                        ? 'You’re all caught up'
                        : 'Your conversations start here'}
                  </p>
                  {!query && !unread && (
                    <Button
                      className="mt-5"
                      variant="outline"
                      onClick={() => setDialog('new')}
                    >
                      <Plus /> Start a chat
                    </Button>
                  )}
                </div>
              )}
              {filtered.map((room) => {
                const other = room.members.find((a) => a.id !== actor.id)
                const count = room.unread
                return (
                  <button
                    key={room.id}
                    onClick={() => {
                      setOpenedRoom(room)
                      setSelectedId(room.id)
                    }}
                    aria-current={selectedId === room.id ? 'true' : undefined}
                    className={cn(
                      'conversation-row mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3.5 text-left',
                      selectedId === room.id && 'is-selected',
                    )}
                  >
                    <ChatAvatar
                      name={roomTitle(room, actor)}
                      kind={room.kind === 'group' ? 'group' : other?.kind}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span
                          className={cn(
                            'truncate text-[15px] font-medium',
                            count > 0 && 'font-semibold',
                          )}
                        >
                          {roomTitle(room, actor)}
                        </span>
                        <time
                          dateTime={room.updated_at}
                          title={new Date(room.updated_at).toLocaleString()}
                          className={cn(
                            'shrink-0 text-xs tabular-nums text-muted-foreground',
                            count > 0 && 'font-medium text-primary',
                          )}
                        >
                          {conversationTime(room.updated_at)}
                        </time>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <span
                          className={cn(
                            'line-clamp-2 min-w-0 flex-1 text-[13px] leading-5 text-muted-foreground',
                            count > 0 && 'text-foreground/75',
                          )}
                        >
                          {room.preview ||
                            (room.last_seq !== '0'
                              ? 'Attachment'
                              : 'No messages yet')}
                        </span>
                        {count > 0 && (
                          <span
                            aria-label={`${count} unread messages`}
                            className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground"
                          >
                            {count > 99 ? '99+' : String(count)}
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                )
              })}
              {rooms.hasNextPage && (
                <Button
                  variant="ghost"
                  className="my-3 w-full"
                  disabled={rooms.isFetchingNextPage}
                  onClick={() => rooms.fetchNextPage()}
                >
                  Load more conversations
                </Button>
              )}
            </div>
          </aside>
          <div
            className={cn(
              'relative flex min-w-0 flex-1',
              !selectedId && 'hidden md:flex',
            )}
          >
            {!sidebarOpen && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute left-3 top-3 z-10 hidden md:inline-flex"
                aria-label="Show conversation list"
                onClick={() => setSidebarOpen(true)}
              >
                <PanelLeft />
              </Button>
            )}
            {selected ? (
              <ChatWindow
                key={selected.id}
                room={selected}
                actor={actor}
                onBack={() => setSelectedId(null)}
                onDetails={() => setDialog('details')}
                onChanged={refresh}
                sidebarHidden={!sidebarOpen}
                active={view === 'chats'}
              />
            ) : (
              <section
                className={cn(
                  'min-w-0 flex-1 items-center justify-center bg-[var(--chat-surface)] p-8',
                  selectedId ? 'flex' : 'hidden md:flex',
                )}
              >
                <div className="max-w-sm text-center">
                  <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-muted/60">
                    <MessageCircle className="size-9 text-foreground/70" />
                  </div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    What’s on your mind?
                  </h1>
                  <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                    Start a conversation with your agents.
                  </p>
                  <div className="mt-7 flex flex-wrap justify-center gap-3">
                    {actor.kind === 'human' && (
                      <Button onClick={() => openView('agents')}>
                        <Bot className="size-5" /> Connect an agent
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => setDialog('new')}>
                      New conversation
                    </Button>
                  </div>
                  {selectedId && (
                    <Button
                      variant="ghost"
                      className="mt-4 md:hidden"
                      onClick={() => setSelectedId(null)}
                    >
                      Back to chats
                    </Button>
                  )}
                </div>
              </section>
            )}
          </div>
          {view === 'chats' && dialog === 'new' && (
            <NewConversation
              actors={people.data?.actors || []}
              actor={actor}
              onClose={() => setDialog(null)}
              onCreated={(id) => {
                setDialog(null)
                setSelectedId(id)
                refresh()
              }}
            />
          )}
          {view === 'chats' && dialog === 'details' && selected && (
            <ConversationDetails
              room={selected}
              actor={actor}
              actors={people.data?.actors || []}
              onClose={() => setDialog(null)}
              onSaved={refresh}
            />
          )}
        </div>
        {view !== 'chats' && (
          <ManagementPage
            key={view}
            mode={view}
            actor={actor}
            actors={people.data?.actors || []}
            onRefresh={refresh}
            onOpenChat={(id) => {
              setQuery('')
              setUnread(false)
              setSelectedId(id)
              openView('chats')
              refresh()
            }}
          />
        )}
      </main>
    </TooltipProvider>
  )
}

function RailButton({
  label,
  active,
  children,
  onClick,
}: {
  label: string
  active?: boolean
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-current={active ? 'page' : undefined}
          onClick={onClick}
          className={cn(
            'size-10 rounded-xl text-muted-foreground transition-colors duration-150 hover:text-foreground [&_svg]:size-5',
            active &&
              'bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

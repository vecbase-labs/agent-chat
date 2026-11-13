import { useEffect, useState } from 'react'
import {
  Copy,
  Plus,
  RefreshCw,
  Ban,
  Check,
  KeyRound,
  ArrowLeft,
  MoreHorizontal,
  Settings2,
  MessageCircle,
  Bot,
  BookOpen,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '#/components/ui/alert-dialog'
import { api, post } from '#/lib/api-client'
import { authClient } from '#/lib/auth-client'
import { APP_VERSION } from '#/lib/version'
import {
  connectionClients,
  connectionHints,
  connectionPrompt,
} from '#/lib/agent-connection'
import type { ConnectionClient } from '#/lib/agent-connection'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#/lib/password-policy'
import { ChatAvatar } from './avatar'
import { AvatarPicker } from './avatar-picker'
import { AppearanceSettings } from './appearance'
import { AgentActivity } from './agent-activity'
import type { Actor } from '#/lib/types'

type Enrollment = {
  code: string
  expiresIn: number
  server: string
  agentId: string
}
type Props = {
  mode: 'agents' | 'settings'
  actor: Actor
  actors: Actor[]
  onRefresh: () => void
  onOpenChat: (id: string) => void
}
export function ManagementPage({
  mode,
  actor,
  actors,
  onRefresh,
  onOpenChat,
}: Props) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (mode !== 'agents') return
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [mode])
  const [creating, setCreating] = useState(false)
  const [avatarDraft, setAvatarDraft] = useState<Blob | null>()
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [selected, setSelected] = useState<Actor | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [enrollmentName, setEnrollmentName] = useState('')
  const [connectionClient, setConnectionClient] =
    useState<ConnectionClient>('General')
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)
  const [error, setError] = useState('')
  const isOwner = actor.kind === 'human'
  const agentList = actors.filter((a) => a.kind === 'agent')
  async function perform(fn: () => Promise<void>) {
    setPending(true)
    setError('')
    try {
      await fn()
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setPending(false)
    }
  }
  async function createAgent(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (photoProcessing || pending) return
    const form = new FormData(event.currentTarget)
    await perform(async () => {
      const name = String(form.get('name'))
      if (selected) {
        await api('agents/' + selected.id, {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            description: form.get('description'),
          }),
        })
        await saveAvatar(selected.id)
        setSelected(null)
        setCreating(false)
        toast.success('Agent updated')
      } else {
        const data = await post<Enrollment>('agents', {
          name,
          description: form.get('description'),
        })
        try {
          await saveAvatar(data.agentId)
        } catch {
          setError(
            'Agent created, but the photo could not be saved. You can add it in Agent settings.',
          )
        }
        setEnrollmentName(name)
        setConnectionClient('General')
        setEnrollment(data)
        setCreating(false)
      }
    })
  }
  async function saveAvatar(id: string) {
    if (avatarDraft === undefined) return
    await api(
      `agents/${id}/avatar`,
      avatarDraft === null
        ? { method: 'DELETE' }
        : {
            method: 'PUT',
            headers: { 'Content-Type': 'image/png' },
            body: avatarDraft,
          },
    )
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      toast.success('Copied')
    } catch {
      toast.error('Copy is unavailable. Select and copy the text manually.')
    }
  }
  const prompt = enrollment
    ? connectionPrompt(connectionClient, enrollment, enrollmentName)
    : ''
  const title = enrollment
    ? `${enrollment.code ? 'Connect' : 'Update'} ${enrollmentName}`
    : creating
      ? selected
        ? 'Agent settings'
        : 'New agent'
      : mode === 'agents'
        ? 'Agents'
        : 'Settings'
  return (
    <>
      <section
        aria-labelledby="management-title"
        className="min-w-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto w-full max-w-4xl space-y-8 px-5 py-8 md:px-10 md:py-12">
          <header className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <h1
                id="management-title"
                className="text-3xl font-semibold tracking-tight"
              >
                {title}
              </h1>
              <p className="text-base text-muted-foreground">
                {enrollment
                  ? 'Copy this message into your agent’s current chat.'
                  : creating
                    ? 'Give your agent a name, then connect it.'
                    : mode === 'agents'
                      ? 'Connect your agents. Start a chat or add them to a group anytime.'
                      : 'Make yourself at home.'}
              </p>
            </div>
            {isOwner && mode === 'agents' && !creating && !enrollment && (
              <Button
                onClick={() => {
                  setCreating(true)
                  setSelected(null)
                  setAvatarDraft(undefined)
                  setDraftName('')
                }}
                className="shrink-0 rounded-full"
              >
                <Plus /> New agent
              </Button>
            )}
          </header>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {enrollment ? (
            <div className="max-w-2xl space-y-5">
              <div className="space-y-3">
                <div
                  role="group"
                  aria-label="Agent platform"
                  className="inline-flex w-full gap-1 rounded-xl bg-muted p-1 sm:w-auto"
                >
                  {connectionClients.map((client) => (
                    <Button
                      key={client}
                      variant={
                        connectionClient === client ? 'outline' : 'ghost'
                      }
                      className="min-w-0 flex-1 rounded-lg sm:min-w-24"
                      aria-pressed={connectionClient === client}
                      disabled={pending}
                      onClick={() => setConnectionClient(client)}
                    >
                      {client}
                    </Button>
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">
                  {connectionHints[connectionClient]}
                </p>
              </div>
              <Textarea
                aria-label="Connection prompt"
                readOnly
                value={prompt}
                className="min-h-32 text-base leading-relaxed"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {enrollment.code
                    ? 'Expires in 10 minutes · One use'
                    : 'Keeps your existing connection'}
                </span>
                <Button
                  disabled={!prompt || pending}
                  onClick={() => copy(prompt)}
                >
                  <Copy /> Copy prompt
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                The agent needs access to this server. A localhost address is
                reachable only from this computer.
              </p>
              <Button variant="outline" onClick={() => setEnrollment(null)}>
                Done
              </Button>
            </div>
          ) : creating ? (
            <form className="max-w-2xl space-y-5" onSubmit={createAgent}>
              <AvatarPicker
                name={draftName || selected?.name || 'Agent'}
                avatarId={selected?.avatar_id}
                value={avatarDraft}
                onChange={setAvatarDraft}
                disabled={pending}
                onProcessing={setPhotoProcessing}
              />
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  name="name"
                  required
                  maxLength={80}
                  autoFocus
                  defaultValue={selected?.name || ''}
                  onChange={(event) => setDraftName(event.currentTarget.value)}
                  placeholder="e.g. Scout"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-description">Description</Label>
                <Input
                  id="agent-description"
                  name="description"
                  maxLength={500}
                  defaultValue={selected?.description || ''}
                  placeholder="What does this agent help with?"
                />
              </div>
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending || photoProcessing}
                  onClick={() => {
                    setCreating(false)
                    setSelected(null)
                  }}
                >
                  <ArrowLeft /> Back
                </Button>
                <Button disabled={pending || photoProcessing}>
                  {selected ? 'Save changes' : 'Create & connect'}
                </Button>
              </div>
            </form>
          ) : mode === 'agents' ? (
            <div className="space-y-2">
              {agentList.length === 0 && (
                <div className="agent-empty rounded-2xl border border-dashed px-6 py-14 text-center">
                  <Bot className="mx-auto mb-4 size-10 text-muted-foreground/50" />
                  <p className="font-medium">Meet your next conversation.</p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Connect an agent to start chatting and sharing files.
                  </p>
                </div>
              )}
              <div className="agent-list">
                {agentList.map((a) => (
                  <div className="agent-card" key={a.id}>
                    <ChatAvatar
                      name={a.name}
                      kind="agent"
                      avatarId={a.avatar_id}
                      className="size-12 shrink-0 text-lg"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="truncate text-base font-semibold">
                          {a.name}
                        </p>
                        <span className="agent-status">
                          {a.disabled_at
                            ? 'Disabled'
                            : a.paired
                              ? 'Paired'
                              : 'Not connected'}
                        </span>
                      </div>
                      {a.description && (
                        <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                          {a.description}
                        </p>
                      )}
                      {(a.paired || a.last_active_at) && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          <AgentActivity value={a.last_active_at} now={now} />
                        </p>
                      )}
                    </div>
                    <div className="agent-card-actions">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-full"
                        disabled={!!a.disabled_at || pending}
                        onClick={() =>
                          perform(async () => {
                            const room = await post<{ id: string }>(
                              'conversations',
                              { kind: 'direct', members: [a.id] },
                            )
                            onOpenChat(room.id)
                          })
                        }
                      >
                        <MessageCircle className="size-4" />
                        <span className="hidden sm:inline">Message</span>
                        <span className="sr-only sm:hidden">
                          Message {a.name}
                        </span>
                      </Button>
                      {isOwner && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="rounded-full"
                              aria-label={`More options for ${a.name}`}
                              disabled={pending}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-48 rounded-xl p-1.5"
                          >
                            <DropdownMenuItem
                              onSelect={() => {
                                setSelected(a)
                                setCreating(true)
                                setAvatarDraft(undefined)
                                setDraftName(a.name)
                              }}
                            >
                              <Settings2 /> Agent settings
                            </DropdownMenuItem>
                            {a.paired && !a.disabled_at && (
                              <DropdownMenuItem
                                onSelect={() => {
                                  setEnrollmentName(a.name)
                                  setConnectionClient('General')
                                  setEnrollment({
                                    agentId: a.id,
                                    server: window.location.origin,
                                    code: '',
                                    expiresIn: 0,
                                  })
                                }}
                              >
                                <BookOpen /> Update instructions
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem
                              onSelect={() =>
                                setConfirm({
                                  title: a.paired
                                    ? `Reconnect ${a.name}?`
                                    : `Connect ${a.name}?`,
                                  description:
                                    'A new pairing prompt will replace any existing credential for this agent.',
                                  run: async () => {
                                    const data = await post<Enrollment>(
                                      `agents/${a.id}/enrollment`,
                                    )
                                    setEnrollmentName(a.name)
                                    setConnectionClient('General')
                                    setEnrollment(data)
                                  },
                                })
                              }
                            >
                              <RefreshCw />
                              {a.paired ? 'Reconnect' : 'Connect'}
                            </DropdownMenuItem>
                            {!a.disabled_at && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() =>
                                    setConfirm({
                                      title: `Disable ${a.name}?`,
                                      description:
                                        'This immediately revokes access to Agent Chat. It does not stop work already running elsewhere.',
                                      run: async () => {
                                        await api(`agents/${a.id}`, {
                                          method: 'PATCH',
                                          body: JSON.stringify({
                                            disabled: true,
                                          }),
                                        })
                                      },
                                    })
                                  }
                                >
                                  <Ban /> Disable agent
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <AppearanceSettings />
              <div className="flex items-center gap-3 rounded-2xl border p-5">
                <ChatAvatar name={actor.name} />
                <div>
                  <p className="font-medium">{actor.name}</p>
                  <p className="text-sm text-muted-foreground">Your account</p>
                </div>
              </div>
              <form
                className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6"
                onSubmit={(event) => {
                  event.preventDefault()
                  const element = event.currentTarget
                  const form = new FormData(element)
                  void perform(async () => {
                    const result = await authClient.changePassword({
                      currentPassword: String(form.get('current')),
                      newPassword: String(form.get('next')),
                      revokeOtherSessions: true,
                    })
                    if (result.error) throw new Error(result.error.message)
                    toast.success('Password changed')
                    element.reset()
                  })
                }}
              >
                <h3 className="flex items-center gap-2 font-medium">
                  <KeyRound className="size-4" /> Change password
                </h3>
                <div className="space-y-2">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    name="current"
                    type="password"
                    autoComplete="current-password"
                    aria-label="Current password"
                    placeholder="Current password"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    name="next"
                    type="password"
                    autoComplete="new-password"
                    aria-label="New password"
                    placeholder={`New password · at least ${MIN_PASSWORD_LENGTH} characters`}
                    minLength={MIN_PASSWORD_LENGTH}
                    maxLength={MAX_PASSWORD_LENGTH}
                    required
                  />
                </div>
                <Button variant="outline" disabled={pending}>
                  Update password
                </Button>
              </form>
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-5 text-sm text-muted-foreground">
                <span>Agent Chat {APP_VERSION} · Apache-2.0</span>
                <a
                  className="rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  href="https://github.com/vecbase-labs/agent-chat"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub ↗
                </a>
              </footer>
            </div>
          )}
        </div>
      </section>
      <AlertDialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                const action = confirm
                setConfirm(null)
                if (action) void perform(action.run)
              }}
            >
              <Check /> Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

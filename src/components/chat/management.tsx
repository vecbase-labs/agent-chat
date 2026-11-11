import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  Copy,
  Plus,
  RefreshCw,
  Ban,
  Check,
  KeyRound,
  ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { Checkbox } from '#/components/ui/checkbox'
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
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#/lib/password-policy'
import { ChatAvatar } from './avatar'
import { AppearanceSettings } from './appearance'
import type { Actor, Conversation } from '#/lib/types'

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
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Actor | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [enrollmentName, setEnrollmentName] = useState('')
  const [roomIds, setRoomIds] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)
  const [error, setError] = useState('')
  const isOwner = actor.kind === 'human'
  const agentList = actors.filter((a) => a.kind === 'agent')
  const groupPages = useInfiniteQuery({
    queryKey: ['conversations', 'agent-groups'],
    initialPageParam: '',
    queryFn: ({ signal, pageParam }) =>
      api<{ conversations: Conversation[]; nextCursor: string | null }>(
        `conversations?${new URLSearchParams({ all: 'true', ...(pageParam ? { cursor: pageParam } : {}) })}`,
        { signal },
      ),
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: isOwner && mode === 'agents' && creating && !selected,
  })
  const groups = [
    ...new Map(
      (groupPages.data?.pages.flatMap((page) => page.conversations) || [])
        .filter((room) => room.kind === 'group')
        .map((room) => [room.id, room]),
    ).values(),
  ]
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
        setSelected(null)
        setCreating(false)
        toast.success('Agent updated')
      } else {
        const data = await post<Enrollment>('agents', {
          name,
          description: form.get('description'),
          conversations: roomIds,
        })
        setEnrollmentName(name)
        setEnrollment(data)
        setCreating(false)
      }
    })
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
    ? `Connect to Agent Chat as "${enrollmentName}". Follow ${enrollment.server}/connect.md and pair using code ${enrollment.code}.`
    : ''
  const title = enrollment
    ? `Connect ${enrollmentName}`
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
          <header className="space-y-2">
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
                  ? 'Give your agent a name and choose its groups.'
                  : mode === 'agents'
                    ? 'Connect the agents you already use.'
                    : 'Make yourself at home.'}
            </p>
          </header>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {enrollment ? (
            <div className="max-w-2xl space-y-5">
              <Textarea
                aria-label="Connection prompt"
                readOnly
                value={prompt}
                className="min-h-32 text-base leading-relaxed"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  Expires in 10 minutes · One use
                </span>
                <Button onClick={() => copy(prompt)}>
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
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  name="name"
                  required
                  maxLength={80}
                  autoFocus
                  defaultValue={selected?.name || ''}
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
              {!selected && (
                <div className="space-y-3">
                  <Label>Add to groups</Label>
                  {groupPages.isPending && (
                    <p className="text-sm text-muted-foreground">
                      Loading groups…
                    </p>
                  )}
                  {groupPages.error && (
                    <div role="alert" className="text-sm text-destructive">
                      Could not load groups.
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => groupPages.refetch()}
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                  {!groupPages.isPending &&
                    !groupPages.error &&
                    !groupPages.hasNextPage &&
                    groups.length === 0 && (
                      <p className="text-sm text-muted-foreground">
                        Create a group afterwards to start a conversation.
                      </p>
                    )}
                  {groups.map((c) => (
                    <label key={c.id} className="flex items-center gap-3">
                      <Checkbox
                        checked={roomIds.includes(c.id)}
                        onCheckedChange={(checked) =>
                          setRoomIds(
                            checked
                              ? [...roomIds, c.id]
                              : roomIds.filter((id) => id !== c.id),
                          )
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                  {groupPages.hasNextPage && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={groupPages.isFetchingNextPage}
                      onClick={() => groupPages.fetchNextPage()}
                    >
                      Load more groups
                    </Button>
                  )}
                </div>
              )}
              <div className="flex justify-between">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCreating(false)
                    setSelected(null)
                  }}
                >
                  <ArrowLeft /> Back
                </Button>
                <Button disabled={pending}>
                  {selected ? 'Save changes' : 'Create & connect'}
                </Button>
              </div>
            </form>
          ) : mode === 'agents' ? (
            <div className="space-y-2">
              {isOwner && (
                <Button
                  onClick={() => {
                    setCreating(true)
                    setSelected(null)
                    setRoomIds([])
                  }}
                  className="mb-4"
                >
                  <Plus /> New agent
                </Button>
              )}
              {agentList.length === 0 && (
                <p className="py-8 text-center text-muted-foreground">
                  Your agents will appear here.
                </p>
              )}
              {agentList.map((a) => (
                <div
                  className="flex items-start gap-3 border-b py-4 last:border-0"
                  key={a.id}
                >
                  <ChatAvatar name={a.name} kind="agent" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{a.name}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {a.disabled_at
                        ? 'Disabled'
                        : !a.paired
                          ? 'Awaiting connection'
                          : 'Paired'}
                    </p>
                    {a.description && (
                      <p className="mt-2 text-sm">{a.description}</p>
                    )}
                    {isOwner ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
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
                          Message
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSelected(a)
                            setCreating(true)
                          }}
                        >
                          Settings
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending}
                          onClick={() =>
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
                                setEnrollment(data)
                              },
                            })
                          }
                        >
                          <RefreshCw /> {a.paired ? 'Reconnect' : 'Connect'}
                        </Button>
                        {!a.disabled_at && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setConfirm({
                                title: `Disable ${a.name}?`,
                                description:
                                  'This immediately revokes access to Agent Chat. It does not stop work already running elsewhere.',
                                run: async () => {
                                  await api(`agents/${a.id}`, {
                                    method: 'PATCH',
                                    body: JSON.stringify({ disabled: true }),
                                  })
                                },
                              })
                            }
                          >
                            <Ban /> Disable
                          </Button>
                        )}
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3"
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
                        Message
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="max-w-2xl space-y-6">
              <AppearanceSettings />
              <div className="rounded-xl border p-4">
                <p className="font-medium">{actor.name}</p>
                <p className="text-sm text-muted-foreground">Your account</p>
              </div>
              <form
                className="space-y-4"
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
                <Input
                  name="current"
                  type="password"
                  autoComplete="current-password"
                  aria-label="Current password"
                  placeholder="Current password"
                  required
                />
                <Input
                  name="next"
                  type="password"
                  autoComplete="new-password"
                  aria-label="New password"
                  placeholder={`New password · at least ${MIN_PASSWORD_LENGTH} characters`}
                  minLength={MIN_PASSWORD_LENGTH}
                  maxLength={MAX_PASSWORD_LENGTH}
                  required
                />
                <Button variant="outline" disabled={pending}>
                  Update password
                </Button>
              </form>
              <div className="border-t pt-5 text-sm text-muted-foreground space-y-2">
                <p>Agent Chat {APP_VERSION} · Apache-2.0</p>
                <p>
                  You can view conversations between your agents. Agent
                  credentials are separate from your account.
                </p>
                <p>
                  Updates and backups are managed by the installation operator.
                </p>
              </div>
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

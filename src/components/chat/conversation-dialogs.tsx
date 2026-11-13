import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { api, post } from '#/lib/api-client'
import { ChatAvatar } from './avatar'
import type { Actor, Conversation } from '#/lib/types'

export function NewConversation({
  actors,
  actor,
  onClose,
  onCreated,
}: {
  actors: Actor[]
  actor: Actor
  onClose: () => void
  onCreated: (id: string, review?: boolean) => void
}) {
  const [group, setGroup] = useState(false)
  const [agentPair, setAgentPair] = useState(false)
  const [members, setMembers] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creationKey] = useState(() => crypto.randomUUID())
  const available = actors.filter(
    (a) =>
      a.id !== actor.id &&
      (!agentPair || a.kind === 'agent') &&
      !a.disabled_at &&
      a.name.toLowerCase().includes(search.toLowerCase()),
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {group ? 'New group' : 'New message'}
          </DialogTitle>
          <DialogDescription>
            Choose who you want to talk with.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault()
            const form = new FormData(event.currentTarget)
            setBusy(true)
            setError('')
            try {
              const result = await post<{ id: string }>('conversations', {
                kind: group ? 'group' : 'direct',
                name: group ? form.get('name') : undefined,
                members,
                idempotencyKey: group ? creationKey : undefined,
              })
              onCreated(result.id, agentPair)
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Unable to create conversation.',
              )
            } finally {
              setBusy(false)
            }
          }}
        >
          {actor.kind === 'human' && (
            <div className="flex gap-1 rounded-xl bg-muted/70 p-1">
              <Button
                type="button"
                className="flex-1 rounded-lg shadow-none"
                variant={!group ? 'outline' : 'ghost'}
                aria-pressed={!group}
                onClick={() => {
                  setGroup(false)
                  setAgentPair(false)
                  setMembers([])
                }}
              >
                Direct message
              </Button>
              <Button
                type="button"
                className="flex-1 rounded-lg shadow-none"
                variant={group ? 'outline' : 'ghost'}
                aria-pressed={group}
                onClick={() => {
                  setGroup(true)
                  setAgentPair(false)
                  setMembers([])
                }}
              >
                Group
              </Button>
            </div>
          )}
          {!group && actor.kind === 'human' && (
            <label className="flex items-center gap-3 text-sm">
              <Checkbox
                checked={agentPair}
                onCheckedChange={(checked) => {
                  setAgentPair(!!checked)
                  setMembers([])
                }}
              />{' '}
              Connect two agents to each other
            </label>
          )}
          {group && (
            <div className="space-y-2">
              <Label htmlFor="group-name">Group name</Label>
              <Input
                id="group-name"
                name="name"
                required
                maxLength={100}
                autoFocus
                placeholder="e.g. Research"
              />
            </div>
          )}
          <Input
            aria-label="Find an agent"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find an agent"
          />
          <div className="chat-scroll max-h-72 overflow-y-auto space-y-1">
            {available.length === 0 && (
              <p className="py-5 text-sm text-muted-foreground">
                {search
                  ? 'No matching agents.'
                  : 'Create an agent to start a conversation.'}
              </p>
            )}
            {available.map((a) => (
              <label
                className="flex cursor-pointer items-center gap-3 rounded-xl p-3 hover:bg-muted"
                key={a.id}
              >
                <Checkbox
                  checked={members.includes(a.id)}
                  onCheckedChange={(checked) =>
                    setMembers(
                      group || agentPair
                        ? checked
                          ? agentPair
                            ? [...members, a.id].slice(-2)
                            : [...members, a.id]
                          : members.filter((id) => id !== a.id)
                        : checked
                          ? [a.id]
                          : [],
                    )
                  }
                />
                <ChatAvatar
                  name={a.name}
                  kind={a.kind}
                  avatarId={a.avatar_id}
                />
                <span className="flex-1">{a.name}</span>
                {a.kind === 'agent' && (
                  <span className="text-sm text-muted-foreground">Agent</span>
                )}
              </label>
            ))}
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button
            className="w-full"
            disabled={
              busy ||
              members.length === 0 ||
              (agentPair && members.length !== 2)
            }
          >
            {group ? 'Create group' : 'Start conversation'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConversationDetails({
  room,
  actor,
  actors,
  onClose,
  onSaved,
}: {
  room: Conversation
  actor: Actor
  actors: Actor[]
  onClose: () => void
  onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [members, setMembers] = useState(
    room.members.filter((a) => !a.disabled_at).map((a) => a.id),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {room.kind === 'group' ? room.name : 'Conversation details'}
          </DialogTitle>
          <DialogDescription>
            {room.members.length} participants
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          {(editing ? actors.filter((a) => !a.disabled_at) : room.members).map(
            (a) => (
              <label
                key={a.id}
                className="flex items-center gap-3 rounded-xl py-3"
              >
                {editing && (
                  <Checkbox
                    checked={members.includes(a.id)}
                    onCheckedChange={(checked) =>
                      setMembers(
                        checked
                          ? [...members, a.id]
                          : members.filter((id) => id !== a.id),
                      )
                    }
                  />
                )}
                <ChatAvatar
                  name={a.name}
                  kind={a.kind}
                  avatarId={a.avatar_id}
                />
                <div className="flex-1">
                  <p className="font-medium">{a.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {a.deleted_at
                      ? 'Deleted agent'
                      : a.kind === 'agent'
                        ? 'Your agent'
                        : 'You'}
                  </p>
                </div>
              </label>
            ),
          )}
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground">
          You and the selected agents can read this conversation and its
          attachments. Newly added members can read earlier messages.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {actor.kind === 'human' &&
          room.kind === 'group' &&
          (editing ? (
            <Button
              disabled={busy || !members.length}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await api(`conversations/${room.id}/members`, {
                    method: 'PUT',
                    body: JSON.stringify({ members }),
                  })
                  toast.success('Participants updated')
                  onSaved()
                  onClose()
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : 'Update failed.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save participants
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setEditing(true)}>
              Manage participants
            </Button>
          ))}
      </DialogContent>
    </Dialog>
  )
}

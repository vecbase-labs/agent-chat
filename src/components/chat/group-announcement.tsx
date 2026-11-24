import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Megaphone, Pencil } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import { api, post } from '#/lib/api-client'
import type { Actor, Conversation } from '#/lib/types'

type Announcement = { text: string; version: string; updatedAt: string | null }
export function GroupAnnouncement({
  room,
  actor,
}: {
  room: Conversation
  actor: Actor
}) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Announcement | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = actor.kind === 'human' && actor.id === room.owner_id
  const queryKey = ['announcement', room.id]
  const announcement = useQuery({
    queryKey,
    queryFn: () => api<Announcement>(`conversations/${room.id}/announcement`),
    refetchInterval: 5000,
  })
  const value = announcement.data
  useEffect(() => {
    if (open && value)
      void post(`conversations/${room.id}/announcement-read`, {
        version: value.version,
      }).catch(() => {})
  }, [open, value?.version, room.id])
  const edit = () => {
    if (!value) return
    setDraft({ ...value })
    setError('')
  }
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true)
          setDraft(null)
          setError('')
        }}
        className="flex w-full shrink-0 items-center gap-3 border-b border-border/50 bg-muted/25 px-5 py-2.5 text-left text-sm transition-colors hover:bg-muted/50"
        aria-label="Group announcement"
      >
        <Megaphone className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {value?.text ||
            (announcement.isError
              ? 'Announcement unavailable'
              : 'Group announcement')}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) {
            setOpen(next)
            setDraft(null)
            setError('')
          }
        }}
      >
        <DialogContent className="rounded-2xl sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Group announcement</DialogTitle>
            <DialogDescription>{room.name}</DialogDescription>
          </DialogHeader>
          {announcement.isPending ? (
            <p className="py-6 text-sm text-muted-foreground">
              Loading announcement…
            </p>
          ) : announcement.isError ? (
            <div role="alert" className="space-y-3">
              <p>Unable to load the announcement.</p>
              <Button
                variant="outline"
                onClick={() => void announcement.refetch()}
              >
                Try again
              </Button>
            </div>
          ) : draft ? (
            <form
              className="space-y-4"
              onSubmit={async (event) => {
                event.preventDefault()
                setBusy(true)
                setError('')
                try {
                  const saved = await api<Announcement>(
                    `conversations/${room.id}/announcement`,
                    {
                      method: 'PUT',
                      body: JSON.stringify({
                        text: draft.text,
                        version: draft.version,
                      }),
                    },
                  )
                  client.setQueryData(queryKey, saved)
                  setDraft(null)
                } catch (err) {
                  setError(
                    err instanceof Error
                      ? err.message
                      : 'Unable to save announcement.',
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Textarea
                autoFocus
                aria-label="Announcement text"
                value={draft.text}
                maxLength={2000}
                disabled={busy}
                placeholder="Share what everyone in this group should know."
                className="min-h-48 resize-y text-base leading-relaxed"
                onChange={(event) =>
                  setDraft({ ...draft, text: event.target.value })
                }
              />
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">
                  {draft.text.length} / 2,000
                </span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setDraft(null)}
                  >
                    Cancel
                  </Button>
                  <Button disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
                </div>
              </div>
              {error && (
                <div
                  role="alert"
                  className="space-y-2 text-sm text-destructive"
                >
                  <p>{error}</p>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      const current = await announcement.refetch()
                      if (current.data) {
                        setDraft({ ...current.data })
                        setError('')
                      }
                    }}
                  >
                    Reload current announcement
                  </Button>
                </div>
              )}
            </form>
          ) : (
            <>
              <p className="max-h-[55dvh] overflow-y-auto whitespace-pre-wrap break-words py-2 text-base leading-relaxed">
                {value?.text || 'No announcement yet.'}
              </p>
              <div className="flex items-center justify-between gap-3 border-t pt-4">
                <span className="text-sm text-muted-foreground">
                  {value?.updatedAt
                    ? `Updated ${new Date(value.updatedAt).toLocaleString()}`
                    : 'Visible to everyone in this group'}
                </span>
                {owner && (
                  <Button variant="outline" onClick={edit}>
                    <Pencil className="size-4" />
                    {value?.text ? 'Edit' : 'Add'}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

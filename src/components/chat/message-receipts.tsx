import { Check, CheckCheck } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '#/components/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'
import { ChatAvatar } from './avatar'
import type { Conversation, Message } from '#/lib/types'

type Participant = { id: string; name: string }

export function MessageReceipts({
  message,
  readers,
  participants,
  room,
}: {
  message: Message
  readers: Participant[]
  participants: Participant[]
  room: Conversation
}) {
  const recipients = participants.filter(
    (person) => person.id !== message.sender_id,
  )
  const readIds = new Set(readers.map((person) => person.id))
  const read = recipients.filter((person) => readIds.has(person.id))
  const unread = recipients.filter((person) => !readIds.has(person.id))
  const label = read.length
    ? `Read by ${read.map((person) => person.name).join(', ')}`
    : 'Sent · saved on server'
  if (room.kind === 'direct')
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="message-receipt" aria-label={label}>
            {read.length ? (
              <CheckCheck className="size-3.5" />
            ) : (
              <Check className="size-3.5" />
            )}
            <span>{read.length ? 'Read' : 'Sent'}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent sideOffset={8} className="max-w-64 text-sm">
          {label}
        </TooltipContent>
      </Tooltip>
    )
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="message-receipt rounded-sm py-0.5 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
          aria-label={`Read status: ${read.length} of ${recipients.length}`}
        >
          {read.length ? (
            <CheckCheck className="size-3.5" />
          ) : (
            <Check className="size-3.5" />
          )}
          <span>
            Read {read.length}/{recipients.length}
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[80dvh] overflow-y-auto rounded-2xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Read receipts</DialogTitle>
          <DialogDescription>
            Current participants, excluding the sender.
          </DialogDescription>
        </DialogHeader>
        <p className="line-clamp-2 break-words rounded-lg bg-muted/60 p-3 text-sm text-muted-foreground">
          {message.text || 'Attachment'}
        </p>
        {[
          { title: 'Read', people: read },
          { title: 'Not read', people: unread },
        ].map(({ title, people }) => (
          <section key={title} aria-label={title}>
            <h3 className="mb-2 text-sm font-medium">
              {title}{' '}
              <span className="ml-1 text-muted-foreground">
                {people.length}
              </span>
            </h3>
            {people.length ? (
              <ul className="space-y-1">
                {people.map((person) => {
                  const actor = room.members.find(
                    (member) => member.id === person.id,
                  )
                  return (
                    <li
                      key={person.id}
                      className="flex items-center gap-3 rounded-lg py-2"
                    >
                      <ChatAvatar
                        name={person.name}
                        kind={actor?.kind}
                        avatarId={actor?.avatar_id}
                        className="size-9 shrink-0"
                      />
                      <span className="min-w-0 break-words text-sm">
                        {person.name}
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">
                {title === 'Read'
                  ? 'No one yet.'
                  : 'Everyone has read this message.'}
              </p>
            )}
          </section>
        ))}
      </DialogContent>
    </Dialog>
  )
}

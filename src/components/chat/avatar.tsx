import { Bot, Users } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '#/components/ui/avatar'
import { cn } from '#/lib/utils'

type AvatarMember = { id: string; name: string; avatar_id?: string | null }
export const avatarUrl = (id?: string | null) =>
  id ? `/api/v1/avatars/${id}` : undefined

function initialsFor(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase() || '?'
  )
}
function paletteFor(name: string) {
  return (
    Array.from(name).reduce(
      (hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0,
      0,
    ) % 6
  )
}

function GroupAvatar({
  members,
  className,
}: {
  members: AvatarMember[]
  className?: string
}) {
  // Stable identity order, independent of list ordering and recent messages.
  const shown = [
    ...new Map(members.map((member) => [member.id, member])).values(),
  ]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, 4)
  return (
    <Avatar
      aria-hidden="true"
      className={cn(
        'group-avatar size-11 shrink-0 rounded-[28%] text-base',
        className,
      )}
    >
      <AvatarFallback
        className="group-avatar-grid rounded-[28%] bg-muted"
        data-count={shown.length}
      >
        {shown.length ? (
          shown.map((member) => (
            <span
              key={member.id}
              className="chat-avatar group-avatar-cell"
              data-palette={paletteFor(member.name)}
            >
              <Avatar className="size-full">
                <AvatarImage
                  src={avatarUrl(member.avatar_id)}
                  alt=""
                  className="object-cover"
                />
                <AvatarFallback className="avatar-monogram text-[inherit] font-semibold">
                  {initialsFor(member.name)}
                </AvatarFallback>
              </Avatar>
            </span>
          ))
        ) : (
          <Users className="size-5 text-muted-foreground" />
        )}
      </AvatarFallback>
    </Avatar>
  )
}

export function ChatAvatar({
  name,
  kind,
  className,
  members = [],
  avatarId,
  preview,
}: {
  name: string
  kind?: string
  className?: string
  members?: AvatarMember[]
  avatarId?: string | null
  preview?: string
}) {
  if (kind === 'group')
    return <GroupAvatar members={members} className={className} />
  const initials = initialsFor(name)
  const palette = paletteFor(name)
  return (
    <Avatar
      aria-hidden="true"
      data-palette={palette}
      className={cn(
        'chat-avatar relative size-11 shrink-0 overflow-visible',
        className,
      )}
    >
      <AvatarImage
        src={preview || avatarUrl(avatarId)}
        alt=""
        className="rounded-full object-cover"
      />
      <AvatarFallback
        className={cn(
          'avatar-monogram rounded-full text-[0.9em] font-semibold tracking-tight',
        )}
      >
        {initials}
      </AvatarFallback>
      {kind === 'agent' && (
        <span className="avatar-badge absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border-2 border-background bg-foreground text-background">
          <Bot className="size-2.5" strokeWidth={2} />
        </span>
      )}
    </Avatar>
  )
}

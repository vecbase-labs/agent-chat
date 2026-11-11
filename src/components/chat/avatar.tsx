import { Bot, Users } from 'lucide-react'
import { Avatar, AvatarFallback } from '#/components/ui/avatar'
import { cn } from '#/lib/utils'

export function ChatAvatar({
  name,
  kind,
  className,
}: {
  name: string
  kind?: string
  className?: string
}) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join('')
      .toUpperCase() || '?'
  const palette =
    Array.from(name).reduce(
      (hash, char) => (hash * 31 + char.codePointAt(0)!) >>> 0,
      0,
    ) % 6
  return (
    <Avatar
      aria-hidden="true"
      data-palette={palette}
      className={cn(
        'chat-avatar relative size-11 shrink-0 overflow-visible',
        className,
      )}
    >
      <AvatarFallback
        className={cn(
          'avatar-monogram rounded-full text-[0.9em] font-semibold tracking-tight',
        )}
      >
        {kind === 'group' ? <Users className="size-5" /> : initials}
      </AvatarFallback>
      {kind === 'agent' && (
        <span className="avatar-badge absolute -right-0.5 -bottom-0.5 flex size-4 items-center justify-center rounded-full border-2 border-background bg-foreground text-background">
          <Bot className="size-2.5" strokeWidth={2} />
        </span>
      )}
    </Avatar>
  )
}

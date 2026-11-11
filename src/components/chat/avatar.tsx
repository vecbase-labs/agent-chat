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
  return (
    <Avatar className={cn('size-11 shrink-0', className)}>
      <AvatarFallback
        className={cn(
          'bg-muted font-medium',
          kind === 'agent' &&
            'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
        )}
      >
        {kind === 'agent' ? (
          <Bot className="size-5" />
        ) : kind === 'group' ? (
          <Users className="size-5" />
        ) : (
          name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((n) => n[0])
            .join('')
            .toUpperCase()
        )}
      </AvatarFallback>
    </Avatar>
  )
}

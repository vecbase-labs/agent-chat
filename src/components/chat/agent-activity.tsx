import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '#/components/ui/tooltip'

function activityLabel(timestamp: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000))
  if (minutes < 1) return 'Active just now'
  if (minutes < 60) return `Active ${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Active ${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  const days = Math.floor(hours / 24)
  return `Active ${days} ${days === 1 ? 'day' : 'days'} ago`
}

export function AgentActivity({
  value,
  now,
}: {
  value: string | null
  now: number
}) {
  if (!value) return <span>No activity yet</span>
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={value}
          tabIndex={0}
          className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
        >
          {activityLabel(new Date(value).getTime(), now)}
        </time>
      </TooltipTrigger>
      <TooltipContent className="max-w-72 text-sm">
        <p>{new Date(value).toLocaleString()}</p>
        <p className="mt-1">
          Last successful connection. This does not mean messages were read.
        </p>
      </TooltipContent>
    </Tooltip>
  )
}

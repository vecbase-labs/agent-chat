import { createFileRoute } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, MessageCircle } from 'lucide-react'
import { AccountScreen } from '#/components/account-screen'
import { ChatShell } from '#/components/chat/chat-shell'
import { Button } from '#/components/ui/button'
import { api } from '#/lib/api-client'
import type { Bootstrap } from '#/lib/types'

export const Route = createFileRoute('/')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { view: 'chats' | 'agents' | 'settings' } => ({
    view:
      search.view === 'agents' || search.view === 'settings'
        ? search.view
        : 'chats',
  }),
  component: App,
})
function App() {
  const client = useQueryClient()
  const bootstrap = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => api<Bootstrap>('bootstrap'),
    retry: false,
  })
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['bootstrap'] })
  }
  if (bootstrap.isPending)
    return (
      <main className="flex min-h-dvh items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="animate-spin" /> Loading Agent Chat
      </main>
    )
  if (bootstrap.error)
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <MessageCircle className="size-10" />
        <h1 className="text-2xl font-semibold">Unable to connect</h1>
        <p className="text-muted-foreground">
          Check that PostgreSQL is running and database migrations have been
          applied.
        </p>
        <Button onClick={() => bootstrap.refetch()}>Try again</Button>
      </main>
    )
  if (!bootstrap.data.actor)
    return <AccountScreen bootstrap={bootstrap.data} onSuccess={refresh} />
  return (
    <ChatShell
      bootstrap={bootstrap.data}
      onSignOut={() => window.location.replace('/')}
    />
  )
}

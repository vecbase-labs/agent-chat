import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { api, post } from '#/lib/api-client'
import {
  connectionClients,
  connectionHints,
  connectionPrompt,
  DEFAULT_CHECK_INTERVAL_MINUTES,
} from '#/lib/agent-connection'
import type { ConnectionClient } from '#/lib/agent-connection'
import { ConnectionInterval } from './connection-interval'

export type Enrollment = {
  code: string
  expiresIn: number
  expiresAt?: string
  enrollmentId?: string
  server: string
  agentId: string
  initialConnection?: boolean
}
type PairingStatus = {
  status: 'active' | 'expired' | 'replaced' | 'paired' | 'disabled'
  expiresIn: number
}

export function AgentConnection({
  initialEnrollment,
  name,
  onDone,
  onRefresh,
}: {
  initialEnrollment: Enrollment
  name: string
  onDone: () => void
  onRefresh: () => void
}) {
  const [enrollment, setEnrollment] = useState(initialEnrollment)
  const [client, setClient] = useState<ConnectionClient>('General')
  const [interval, setIntervalMinutes] = useState<number | null | undefined>(
    enrollment.initialConnection ? DEFAULT_CHECK_INTERVAL_MINUTES : undefined,
  )
  const [now, setNow] = useState(Date.now)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pairing = !!enrollment.code
  const status = useQuery({
    queryKey: ['pairing-status', enrollment.agentId, enrollment.enrollmentId],
    queryFn: () =>
      api<PairingStatus>(
        `agents/${enrollment.agentId}/enrollment?enrollmentId=${enrollment.enrollmentId}`,
      ),
    enabled: pairing && !!enrollment.enrollmentId,
    refetchInterval: (query) =>
      query.state.data?.status === 'active' ? 5000 : false,
    retry: false,
  })
  useEffect(() => {
    if (!pairing || status.data?.status !== 'active') return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [pairing, status.data?.status])
  useEffect(() => {
    if (status.data?.status === 'paired') {
      setError('')
      onRefresh()
    }
  }, [status.data?.status, onRefresh])
  // Use the server's remaining lifetime, so a different client clock is harmless.
  const remaining = Math.max(
    0,
    Math.min(
      status.data?.expiresIn || 0,
      Math.ceil(
        (status.dataUpdatedAt + (status.data?.expiresIn || 0) * 1000 - now) /
          1000,
      ),
    ),
  )
  const valid =
    !pairing ||
    (!status.isError && status.data?.status === 'active' && remaining > 0)
  const paired = pairing && status.data?.status === 'paired'
  const prompt =
    valid && (!pairing || interval !== null)
      ? connectionPrompt(
          client,
          enrollment,
          name,
          pairing ? (interval ?? undefined) : undefined,
        )
      : ''
  const statusText = !pairing
    ? 'Keeps your existing connection'
    : status.isError
      ? 'Unable to check this code. Try again.'
      : paired
        ? 'Connected'
        : status.data?.status === 'disabled'
          ? 'This agent is disabled. Return to Agents to reconnect it.'
          : status.data?.status === 'replaced'
            ? 'This code was replaced. Get a new code to continue.'
            : status.data?.status === 'expired' ||
                (status.data && remaining === 0)
              ? 'This code has expired. Get a new code to continue.'
              : status.data?.status === 'active'
                ? `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} · One use`
                : 'Checking pairing code…'

  async function copyPrompt() {
    if (busy || !prompt) return
    setBusy(true)
    setError('')
    try {
      // Recheck before copying; another tab or the agent may have consumed the code.
      if (pairing) {
        const latest = await status.refetch()
        if (latest.error)
          throw new Error('Unable to check this code. Try again.')
        if (latest.data?.status !== 'active' || latest.data.expiresIn <= 0)
          return
      }
      await navigator.clipboard.writeText(prompt)
      toast.success('Copied')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Copy is unavailable. Select and copy the text manually.',
      )
    } finally {
      setBusy(false)
    }
  }
  async function refreshCode() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      // Refreshing a code must never revoke an agent that has just connected.
      const next = await post<Enrollment>(
        `agents/${enrollment.agentId}/enrollment?refresh=true`,
      )
      setNow(Date.now())
      setEnrollment({
        ...next,
        initialConnection: enrollment.initialConnection,
      })
      onRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to get a new code.')
      void status.refetch()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="max-w-2xl space-y-5">
      {paired ? (
        <div
          className="flex items-center gap-3 rounded-xl border bg-muted/40 p-5"
          role="status"
        >
          <Check className="size-5 text-primary" />
          <p>{name} is connected. You can start chatting.</p>
        </div>
      ) : (
        <>
          <p className="text-base text-muted-foreground">
            Copy this message into your agent’s current chat.
          </p>
          <fieldset disabled={busy} className="space-y-5">
            <div className="space-y-3">
              <div
                role="group"
                aria-label="Agent platform"
                className="inline-flex w-full gap-1 rounded-xl bg-muted p-1 sm:w-auto"
              >
                {connectionClients.map((platform) => (
                  <Button
                    key={platform}
                    variant={client === platform ? 'outline' : 'ghost'}
                    className="min-w-0 flex-1 rounded-lg sm:min-w-24"
                    aria-pressed={client === platform}
                    onClick={() => setClient(platform)}
                  >
                    {platform}
                  </Button>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {connectionHints[client]}
              </p>
            </div>
            {pairing && (
              <ConnectionInterval
                preserveExisting={!enrollment.initialConnection}
                onChange={setIntervalMinutes}
              />
            )}
          </fieldset>
          <Textarea
            aria-label="Connection prompt"
            readOnly
            value={prompt}
            placeholder={
              !valid
                ? 'Get a new pairing code to continue.'
                : 'Choose a check interval to generate your connection prompt.'
            }
            className="min-h-32 text-base leading-relaxed"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">{statusText}</span>
            <Button
              disabled={!prompt || busy || (pairing && status.isFetching)}
              onClick={() => void copyPrompt()}
            >
              <Copy /> Copy prompt
            </Button>
          </div>
          {pairing && (
            <Button
              variant="outline"
              disabled={busy || status.data?.status === 'disabled'}
              onClick={() => void refreshCode()}
            >
              <RefreshCw className={busy ? 'animate-spin' : ''} /> Get new
              pairing code
            </Button>
          )}
          <p className="text-sm text-muted-foreground">
            The agent needs access to this server. A localhost address is
            reachable only from this computer.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button variant="outline" disabled={busy} onClick={onDone}>
        Back to agents
      </Button>
    </div>
  )
}

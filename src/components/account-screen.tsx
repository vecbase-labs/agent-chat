import { useState } from 'react'
import { MessageCircle, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { post } from '#/lib/api-client'
import { authClient } from '#/lib/auth-client'
import { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '#/lib/password-policy'
import type { Bootstrap } from '#/lib/types'

export function AccountScreen({
  bootstrap,
  onSuccess,
}: {
  bootstrap: Bootstrap
  onSuccess: () => void
}) {
  const setup = !bootstrap.initialized
  const creating = setup
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    const username = String(form.get('username')).toLowerCase()
    const password = String(form.get('password'))
    try {
      if (creating)
        await post('setup', {
          username,
          password,
          name: form.get('name'),
        })
      const result = await authClient.signIn.username({ username, password })
      if (result.error)
        throw new Error(result.error.message || 'Unable to sign in.')
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to continue.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-muted/30 px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <MessageCircle className="size-6" />
          </div>
          <span className="text-xl font-semibold">Agent Chat</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {setup ? 'Make yourself at home.' : 'Welcome back.'}
        </h1>
        <p className="mt-3 mb-8 text-base leading-relaxed text-muted-foreground">
          {setup
            ? 'Create your account. Then bring your agents together.'
            : 'A place for you and your agents.'}
        </p>
        <form onSubmit={submit} className="space-y-5">
          {creating && (
            <Field
              label="Your name"
              name="name"
              autoComplete="name"
              maxLength={80}
            />
          )}
          <Field
            label="Username"
            name="username"
            autoComplete="username"
            pattern="[a-zA-Z0-9_]{3,40}"
            title="3–40 letters, numbers, or underscores"
            maxLength={40}
          />
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            minLength={creating ? MIN_PASSWORD_LENGTH : undefined}
            maxLength={MAX_PASSWORD_LENGTH}
          />
          {creating && (
            <p className="text-sm text-muted-foreground">
              Use at least {MIN_PASSWORD_LENGTH} characters. Keep it in your
              password manager.
            </p>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <Button
            disabled={busy}
            size="lg"
            className="w-full text-base"
            type="submit"
          >
            {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}{' '}
            {setup ? 'Create account' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-10 text-sm text-muted-foreground">
          Self-hosted · v{bootstrap.version}
        </p>
      </div>
    </main>
  )
}
function Field({
  label,
  ...props
}: React.ComponentProps<typeof Input> & { label: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.name}>{label}</Label>
      <Input
        id={props.name}
        required
        className="h-11 text-base md:text-base"
        {...props}
      />
    </div>
  )
}

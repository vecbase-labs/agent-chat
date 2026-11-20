import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  DEFAULT_CHECK_INTERVAL_MINUTES,
  MAX_CHECK_INTERVAL_MINUTES,
  parseCheckInterval,
} from '#/lib/agent-connection'

export function ConnectionInterval({
  onChange,
  preserveExisting,
}: {
  onChange: (minutes: number | null | undefined) => void
  preserveExisting: boolean
}) {
  const [choice, setChoice] = useState(
    preserveExisting ? 'keep' : String(DEFAULT_CHECK_INTERVAL_MINUTES),
  )
  const [custom, setCustom] = useState('')
  const invalid = choice === 'custom' && parseCheckInterval(custom) === null
  return (
    <div className="space-y-2">
      <Label htmlFor="check-interval">Check interval</Label>
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id="check-interval"
              variant="outline"
              className="min-w-40 justify-between rounded-lg"
              aria-describedby="check-interval-help"
            >
              {choice === 'keep'
                ? 'Keep existing'
                : choice === 'custom'
                  ? 'Custom'
                  : `${choice} minutes`}
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40 rounded-lg">
            <DropdownMenuRadioGroup
              value={choice}
              onValueChange={(value) => {
                setChoice(value)
                onChange(
                  value === 'keep'
                    ? undefined
                    : parseCheckInterval(value === 'custom' ? custom : value),
                )
              }}
            >
              {preserveExisting && (
                <DropdownMenuRadioItem value="keep">
                  Keep existing
                </DropdownMenuRadioItem>
              )}
              {[5, 10, 30, 60].map((minutes) => (
                <DropdownMenuRadioItem key={minutes} value={String(minutes)}>
                  {minutes} minutes
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value="custom">
                Custom…
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {choice === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              id="custom-check-interval"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_CHECK_INTERVAL_MINUTES}
              step={1}
              value={custom}
              autoFocus
              aria-invalid={invalid}
              aria-describedby={
                invalid ? 'check-interval-error' : 'check-interval-help'
              }
              className="w-24 rounded-lg"
              onChange={(event) => {
                setCustom(event.currentTarget.value)
                onChange(parseCheckInterval(event.currentTarget.value))
              }}
            />
            <Label htmlFor="custom-check-interval">Minutes</Label>
          </div>
        )}
      </div>
      {invalid && (
        <p
          id="check-interval-error"
          role="alert"
          className="text-sm text-destructive"
        >
          Enter 1–1,440 whole minutes.
        </p>
      )}
      <p id="check-interval-help" className="text-sm text-muted-foreground">
        Included in your connection prompt. Change it later by asking your
        agent.
      </p>
    </div>
  )
}

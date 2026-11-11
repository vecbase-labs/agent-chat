import { useEffect, useSyncExternalStore } from 'react'
import { Check, Monitor, Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '#/components/ui/button'
import { cn } from '#/lib/utils'

export const CHAT_COLORS = [
  { id: 'blue', label: 'Blue', color: '#2563eb' },
  { id: 'violet', label: 'Violet', color: '#7c3aed' },
  { id: 'rose', label: 'Rose', color: '#be185d' },
  { id: 'teal', label: 'Teal', color: '#0f766e' },
  { id: 'orange', label: 'Orange', color: '#c2410c' },
  { id: 'graphite', label: 'Graphite', color: '#475569' },
] as const
type ChatColor = (typeof CHAT_COLORS)[number]['id']
const storageKey = 'agent-chat-color'
const changeEvent = 'agent-chat-appearance'
let sessionColor: ChatColor | undefined
const valid = (value: string | null): value is ChatColor =>
  CHAT_COLORS.some((color) => color.id === value)

// Apply the saved color before first paint. Only known preset names reach the DOM.
export const APPEARANCE_INIT_SCRIPT = `try{var c=localStorage.getItem('${storageKey}');if(${JSON.stringify(CHAT_COLORS.map((c) => c.id))}.includes(c))document.documentElement.dataset.chatColor=c}catch{}`

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(changeEvent, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(changeEvent, onChange)
  }
}
function getColor(): ChatColor {
  const color = document.documentElement.dataset.chatColor || null
  return valid(color) ? color : 'blue'
}
function getSavedColor(): ChatColor {
  if (sessionColor) return sessionColor
  try {
    const color = localStorage.getItem(storageKey)
    return valid(color) ? color : getColor()
  } catch {
    return getColor()
  }
}
function setColor(color: ChatColor) {
  document.documentElement.dataset.chatColor = color
  try {
    localStorage.setItem(storageKey, color)
    sessionColor = undefined
  } catch {
    // In restricted browsers the choice still lasts for this page session.
    sessionColor = color
  }
  window.dispatchEvent(new Event(changeEvent))
}
export function AppearanceSync() {
  const color = useSyncExternalStore(subscribe, getSavedColor, () => 'blue')
  useEffect(() => {
    document.documentElement.dataset.chatColor = color
  }, [color])
  return null
}

export function AppearanceSettings() {
  const color = useSyncExternalStore(subscribe, getSavedColor, () => 'blue')
  const { theme, setTheme } = useTheme()
  return (
    <section
      className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6"
      aria-labelledby="appearance-title"
    >
      <div>
        <h3 id="appearance-title" className="font-semibold">
          Appearance
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Make this space yours. Saved in this browser.
        </p>
      </div>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Appearance mode"
      >
        {(
          [
            { id: 'light', label: 'Light', Icon: Sun },
            { id: 'dark', label: 'Dark', Icon: Moon },
            { id: 'system', label: 'System', Icon: Monitor },
          ] as const
        ).map(({ id, label, Icon }) => (
          <Button
            key={id}
            variant="outline"
            aria-pressed={theme === id}
            onClick={() => setTheme(id)}
            className={cn(
              'flex-1 rounded-xl',
              theme === id && 'border-primary/40 bg-primary/5 text-primary',
            )}
          >
            <Icon />
            {label}
          </Button>
        ))}
      </div>
      <fieldset>
        <legend className="mb-3 text-sm font-medium">Message color</legend>
        <div className="flex flex-wrap gap-3">
          {CHAT_COLORS.map((option) => (
            <Button
              key={option.id}
              size="icon-lg"
              variant="ghost"
              aria-label={`${option.label} message color`}
              aria-pressed={color === option.id}
              title={option.label}
              onClick={() => setColor(option.id)}
              className="color-swatch rounded-full text-white hover:scale-105"
              style={{
                backgroundColor: option.color,
                outlineColor: option.color,
              }}
            >
              {color === option.id && (
                <Check className="size-5" strokeWidth={2.5} />
              )}
            </Button>
          ))}
        </div>
      </fieldset>
      <div
        className="flex justify-end rounded-xl bg-muted/45 p-4"
        aria-hidden="true"
      >
        <div className="rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          A little more you.
        </div>
      </div>
    </section>
  )
}

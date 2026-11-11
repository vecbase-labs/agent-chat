import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'
import {
  deleteMention,
  editDraft,
  insertMention,
  mentionQuery,
} from '#/lib/mentions'
import type { MentionDraft, TextSelection } from '#/lib/mentions'
import type { Actor } from '#/lib/types'
import type { RefObject } from 'react'
import { ChatAvatar } from './avatar'

export function MentionInput({
  value,
  onChange,
  members,
  inputRef,
  disabled,
  onSend,
}: {
  value: MentionDraft
  onChange: (value: MentionDraft) => void
  members: Actor[]
  inputRef: RefObject<HTMLTextAreaElement | null>
  disabled: boolean
  onSend: () => void
}) {
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const beforeEdit = useRef<TextSelection | undefined>(undefined)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [focused, setFocused] = useState(false)
  const [composing, setComposing] = useState(false)
  const [dismissed, setDismissed] = useState('')
  const [choice, setChoice] = useState({ key: '', index: 0 })
  const query =
    members.length && focused && !composing
      ? mentionQuery(value, selection)
      : null
  const queryKey = query ? `${query.start}:${query.end}:${query.query}` : ''
  const open = !!query && dismissed !== queryKey
  const candidates = query
    ? members
        .filter((member) =>
          member.name
            .toLocaleLowerCase()
            .includes(query.query.toLocaleLowerCase()),
        )
        .slice(0, 50)
    : []
  const index = Math.min(
    choice.key === queryKey ? choice.index : 0,
    Math.max(0, candidates.length - 1),
  )
  const selected = candidates.at(index)
  function currentSelection() {
    const input = inputRef.current
    return { start: input?.selectionStart || 0, end: input?.selectionEnd || 0 }
  }
  function apply(result: { draft: MentionDraft; caret: number }) {
    onChange(result.draft)
    setSelection({ start: result.caret, end: result.caret })
    beforeEdit.current = undefined
    setDismissed('')
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(result.caret, result.caret)
    })
  }
  function choose(member: Actor) {
    if (query) apply(insertMention(value, query, member))
  }
  useEffect(() => {
    if (open)
      list.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: 'nearest' })
  }, [open, index])
  return (
    <div className="relative min-w-0 flex-1">
      {open && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Mention a participant"
          className="absolute bottom-full left-0 z-30 mb-3 max-h-64 w-full min-w-48 overflow-y-auto rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg sm:w-80"
          onPointerDown={(event) => event.preventDefault()}
        >
          {candidates.length ? (
            candidates.map((member, memberIndex) => (
              <Button
                key={member.id}
                id={`${listId}-${member.id}`}
                role="option"
                aria-selected={memberIndex === index}
                tabIndex={-1}
                variant="ghost"
                className={cn(
                  'h-auto w-full justify-start gap-3 rounded-lg px-3 py-2 text-left',
                  memberIndex === index && 'bg-accent',
                )}
                onClick={() => choose(member)}
              >
                <ChatAvatar
                  name={member.name}
                  kind={member.kind}
                  className="size-8 text-xs"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {member.name}
                  </span>
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {member.description ||
                      (member.kind === 'agent' ? 'Agent' : 'You')}
                  </span>
                </span>
              </Button>
            ))
          ) : (
            <p className="px-3 py-4 text-sm text-muted-foreground">
              No matching participants
            </p>
          )}
        </div>
      )}
      <Textarea
        ref={inputRef}
        aria-label="Message"
        aria-autocomplete={members.length ? 'list' : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && selected ? `${listId}-${selected.id}` : undefined
        }
        placeholder="Write a message…"
        className="composer-input min-h-10 max-h-40 resize-none border-0 bg-transparent px-2 py-2.5 text-base leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent md:text-base"
        rows={1}
        value={value.text}
        disabled={disabled}
        onFocus={() => {
          setFocused(true)
          setSelection(currentSelection())
        }}
        onBlur={() => setFocused(false)}
        onSelect={() => setSelection(currentSelection())}
        onBeforeInput={() => {
          beforeEdit.current = currentSelection()
        }}
        onPaste={() => {
          beforeEdit.current = currentSelection()
        }}
        onCut={() => {
          beforeEdit.current = currentSelection()
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => {
          setComposing(false)
          setSelection(currentSelection())
        }}
        onChange={(event) => {
          onChange(
            editDraft(
              value,
              event.target.value,
              beforeEdit.current,
              (event.nativeEvent as InputEvent).inputType || '',
            ),
          )
          beforeEdit.current = undefined
          setSelection(currentSelection())
          setDismissed('')
        }}
        onKeyDown={(event) => {
          beforeEdit.current = currentSelection()
          if (
            event.nativeEvent.isComposing ||
            composing ||
            event.nativeEvent.keyCode === 229
          )
            return
          if (open) {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              setDismissed(queryKey)
              return
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              setChoice({
                key: queryKey,
                index:
                  (index +
                    (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) %
                  Math.max(1, candidates.length),
              })
              return
            }
            if (
              (event.key === 'Enter' || (event.key === 'Tab' && selected)) &&
              !event.shiftKey
            ) {
              event.preventDefault()
              if (selected) choose(selected)
              return
            }
          }
          const deleted = deleteMention(value, currentSelection(), event.key)
          if (deleted) {
            event.preventDefault()
            apply(deleted)
            return
          }
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            window.matchMedia('(pointer: fine)').matches
          ) {
            event.preventDefault()
            onSend()
          }
        }}
      />
    </div>
  )
}

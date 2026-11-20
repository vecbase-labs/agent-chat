export type Mention = { id: string; label: string; start: number; end: number }
export type MentionDraft = { text: string; mentions: Mention[] }
export type TextSelection = { start: number; end: number }

export function editDraft(
  draft: MentionDraft,
  text: string,
  selection?: TextSelection,
  inputType = '',
): MentionDraft {
  if (text === draft.text) return draft
  let start = 0
  while (
    start < text.length &&
    start < draft.text.length &&
    text[start] === draft.text[start]
  )
    start++
  let end = draft.text.length,
    nextEnd = text.length
  while (
    end > start &&
    nextEnd > start &&
    draft.text[end - 1] === text[nextEnd - 1]
  ) {
    end--
    nextEnd--
  }
  if (selection && !inputType.startsWith('history')) {
    let from = selection.start,
      to = selection.end
    const removed = draft.text.length - text.length
    if (from === to && removed > 0) {
      if (inputType.endsWith('Backward')) from = Math.max(0, from - removed)
      else if (inputType.endsWith('Forward')) to += removed
    }
    const prefix = draft.text.slice(0, from),
      suffix = draft.text.slice(to)
    if (
      text.length >= prefix.length + suffix.length &&
      text.startsWith(prefix) &&
      text.endsWith(suffix)
    ) {
      start = from
      end = to
    }
  }
  const delta = text.length - draft.text.length
  const mentions = draft.mentions.flatMap((mention) => {
    const shifted =
      mention.end <= start
        ? mention
        : mention.start >= end
          ? {
              ...mention,
              start: mention.start + delta,
              end: mention.end + delta,
            }
          : null
    return shifted && text.slice(shifted.start, shifted.end) === shifted.label
      ? [shifted]
      : []
  })
  return { text, mentions }
}

export function mentionQuery(draft: MentionDraft, selection: TextSelection) {
  if (selection.start !== selection.end) return null
  const end = selection.start,
    start = draft.text.lastIndexOf('@', end - 1)
  if (start < 0 || start >= end) return null
  // Do not turn an email address or URL into a mention picker.
  if (start > 0 && /[\w.@%+\-/]/u.test(draft.text[start - 1])) return null
  if (
    draft.mentions.some(
      (mention) => start >= mention.start && start < mention.end,
    )
  )
    return null
  const query = draft.text.slice(start + 1, end)
  if (query.length > 80 || /[\r\n@]/u.test(query)) return null
  return { start, end, query }
}

export function insertMention(
  draft: MentionDraft,
  range: TextSelection,
  member: { id: string; name: string },
) {
  const label = '@' + member.name
  const suffix = draft.text.slice(range.end)
  const separator = /^\s/u.test(suffix) ? '' : ' '
  const text = draft.text.slice(0, range.start) + label + separator + suffix
  const next = editDraft(draft, text, range)
  next.mentions.push({
    id: member.id,
    label,
    start: range.start,
    end: range.start + label.length,
  })
  next.mentions.sort((a, b) => a.start - b.start)
  return {
    draft: next,
    caret:
      range.start +
      label.length +
      (suffix.startsWith(' ') ? 1 : separator.length),
  }
}

export function mentionIds(draft: MentionDraft) {
  return [
    ...new Set(
      draft.mentions
        .filter(
          (mention) =>
            draft.text.slice(mention.start, mention.end) === mention.label,
        )
        .map((mention) => mention.id),
    ),
  ]
}

export function deleteMention(
  draft: MentionDraft,
  selection: TextSelection,
  key: string,
) {
  if (selection.start !== selection.end) return null
  const mention = draft.mentions.find((item) =>
    key === 'Backspace'
      ? selection.start > item.start && selection.start <= item.end
      : key === 'Delete' &&
        selection.start >= item.start &&
        selection.start < item.end,
  )
  if (!mention) return null
  return {
    draft: editDraft(
      draft,
      draft.text.slice(0, mention.start) + draft.text.slice(mention.end),
      mention,
    ),
    caret: mention.start,
  }
}

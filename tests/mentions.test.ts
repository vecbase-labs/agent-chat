import { describe, expect, test } from 'vitest'
import {
  deleteMention,
  editDraft,
  insertMention,
  mentionIds,
  mentionQuery,
} from '../src/lib/mentions'
import type { MentionDraft } from '../src/lib/mentions'

const empty = (text: string): MentionDraft => ({ text, mentions: [] })
const muse = { id: 'muse-id', name: 'Muse' }
const mentioned = () =>
  insertMention(empty('@Mu'), { start: 0, end: 3 }, muse).draft

describe('inline mention editing', () => {
  test('queries follow the caret and exclude emails, selected mentions and multiline text', () => {
    expect(mentionQuery(empty('请 @Mu review'), { start: 5, end: 5 })).toEqual({
      start: 2,
      end: 5,
      query: 'Mu',
    })
    expect(mentionQuery(empty('mail@muse'), { start: 9, end: 9 })).toBeNull()
    expect(
      mentionQuery(empty('@Mu\nreview'), { start: 10, end: 10 }),
    ).toBeNull()
    expect(mentionQuery(mentioned(), { start: 5, end: 5 })).toBeNull()
    expect(mentionQuery(empty('@Muse'), { start: 1, end: 5 })).toBeNull()
  })
  test('selection inserts at the caret, preserves suffix and binds a stable identity', () => {
    const result = insertMention(
      empty('Please @Mu review this.'),
      { start: 7, end: 10 },
      muse,
    )
    expect(result.draft.text).toBe('Please @Muse review this.')
    expect(result.caret).toBe(13)
    expect(mentionIds(result.draft)).toEqual(['muse-id'])
    expect(mentionIds(empty(result.draft.text))).toEqual([])
  })
  test('editing surrounding text shifts a mention but editing its text removes the recipient', () => {
    const original = mentioned()
    const prefixed = editDraft(
      original,
      'Hi ' + original.text,
      { start: 0, end: 0 },
      'insertText',
    )
    expect(prefixed.mentions[0].start).toBe(3)
    expect(mentionIds(prefixed)).toEqual(['muse-id'])
    expect(
      mentionIds(
        editDraft(
          prefixed,
          'Hi @Mse ',
          { start: 5, end: 6 },
          'deleteContentBackward',
        ),
      ),
    ).toEqual([])
    expect(
      mentionIds(
        editDraft(original, '', { start: 0, end: original.text.length }),
      ),
    ).toEqual([])
  })
  test('Backspace and Delete remove the selected mention atomically', () => {
    expect(
      deleteMention(mentioned(), { start: 5, end: 5 }, 'Backspace')?.draft,
    ).toEqual(empty(' '))
    expect(
      deleteMention(mentioned(), { start: 0, end: 0 }, 'Delete')?.draft,
    ).toEqual(empty(' '))
    expect(
      deleteMention(mentioned(), { start: 6, end: 6 }, 'Backspace'),
    ).toBeNull()
  })
  test('identical display names retain the chosen IDs when the first occurrence is deleted', () => {
    const first = mentioned()
    const both = insertMention(
      { ...first, text: first.text + '@Mu' },
      { start: 6, end: 9 },
      { id: 'different-id', name: 'Muse' },
    ).draft
    expect(mentionIds(both)).toEqual(['muse-id', 'different-id'])
    const removed = editDraft(
      both,
      '@Muse ',
      { start: 0, end: 6 },
      'deleteByCut',
    )
    expect(mentionIds(removed)).toEqual(['different-id'])
  })
  test('Unicode names and edits use the textarea UTF-16 caret positions', () => {
    const result = insertMention(
      empty('👋 @'),
      { start: 3, end: 4 },
      { id: 'chinese-id', name: '测试员' },
    )
    expect(result.draft.text).toBe('👋 @测试员 ')
    expect(
      mentionIds(
        editDraft(
          result.draft,
          '👋 @测试员 你好',
          { start: 8, end: 8 },
          'insertText',
        ),
      ),
    ).toEqual(['chinese-id'])
  })
  test('typing the same name twice only notifies a selected identity once', () => {
    const first = mentioned()
    const result = insertMention(
      { ...first, text: first.text + '@' },
      { start: 6, end: 7 },
      muse,
    )
    expect(mentionIds(result.draft)).toEqual(['muse-id'])
  })
})

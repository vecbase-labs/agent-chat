export type Actor = {
  id: string
  name: string
  kind: 'human' | 'agent'
  owner_id: string | null
  description: string
  disabled_at: string | null
  deleted_at: string | null
  last_active_at: string | null
  avatar_id: string | null
  paired?: boolean
}
export type Conversation = {
  id: string
  name: string
  kind: 'direct' | 'group'
  last_seq: string
  last_read_seq: string | null
  members: Actor[]
  preview: string | null
  updated_at: string
  archived_at: string | null
  joined: boolean
  attention: number
  unread: number
  owner_id: string
  created_by: string
}
export type Attachment = {
  id: string
  name: string
  bytes: number
  mime_type: string
  sha256: string
}
export type Message = {
  id: string
  conversation_id: string
  seq: string
  text: string
  sender_id: string
  sender_name: string
  sender_kind: 'human' | 'agent'
  sender_avatar_id: string | null
  created_at: string
  reply_to: string | null
  reply_preview: string | null
  reply_seq: string | null
  reply_name: string | null
  mentions: string[]
  files: Attachment[]
  read_by: { id: string; name: string }[]
}
export type Bootstrap = {
  initialized: boolean
  actor: Actor | null
  name: string
  version: string
  apiVersion: number
}

export type FileKind =
  | 'document'
  | 'pdf'
  | 'sheet'
  | 'slides'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'code'
  | 'file'

const extensions: Partial<Record<string, FileKind>> = {
  pdf: 'pdf',
  doc: 'document',
  docx: 'document',
  txt: 'document',
  rtf: 'document',
  md: 'document',
  odt: 'document',
  csv: 'sheet',
  tsv: 'sheet',
  xls: 'sheet',
  xlsx: 'sheet',
  ods: 'sheet',
  ppt: 'slides',
  pptx: 'slides',
  odp: 'slides',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  gif: 'image',
  svg: 'image',
  heic: 'image',
  avif: 'image',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  ogg: 'audio',
  flac: 'audio',
  mp4: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  zip: 'archive',
  gz: 'archive',
  tar: 'archive',
  rar: 'archive',
  '7z': 'archive',
  json: 'code',
  js: 'code',
  ts: 'code',
  tsx: 'code',
  jsx: 'code',
  py: 'code',
  rs: 'code',
  go: 'code',
  html: 'code',
  css: 'code',
  yml: 'code',
  yaml: 'code',
  sql: 'code',
  sh: 'code',
  xml: 'code',
}

export function filePresentation(name: string) {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name)
  const extension = match?.[1].toLowerCase() || ''
  return {
    kind: extensions[extension] || 'file',
    label: extension.toUpperCase() || 'FILE',
    stem: match ? name.slice(0, -match[0].length) : name,
    suffix: match?.[0] || '',
  }
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2)
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function canPreviewImage(file: { name: string; bytes: number }) {
  return (
    file.bytes > 0 &&
    file.bytes <= 5 * 1024 ** 2 &&
    /\.(png|jpe?g|webp)$/i.test(file.name)
  )
}

// File names and declared MIME types are only display hints. Never use them to
// turn arbitrary attachments into active browser documents (including SVG).
export function rasterMime(bytes: Uint8Array) {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'image/jpeg'
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp'
  return null
}

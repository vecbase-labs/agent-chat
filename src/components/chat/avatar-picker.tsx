import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ChatAvatar } from './avatar'

export async function prepareAvatar(file: File) {
  if (
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 5 * 1024 * 1024
  )
    throw new Error('Choose a PNG, JPEG or WebP image up to 5 MB.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new Error('This image could not be opened. Choose another photo.')
  }
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width > 16384 ||
      bitmap.height > 16384
    )
      throw new Error(
        'Choose an image no larger than 16,384 pixels on either side.',
      )
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error('Image processing is unavailable in this browser.')
    const size = Math.min(bitmap.width, bitmap.height)
    context.drawImage(
      bitmap,
      (bitmap.width - size) / 2,
      (bitmap.height - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    )
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob && blob.size <= 256 * 1024
            ? resolve(blob)
            : reject(
                new Error(
                  'This image could not be prepared. Choose another photo.',
                ),
              ),
        'image/png',
      ),
    )
  } finally {
    bitmap.close()
  }
}

export function AvatarPicker({
  name,
  avatarId,
  value,
  onChange,
  disabled,
  onProcessing,
}: {
  name: string
  avatarId?: string | null
  value: Blob | null | undefined
  onChange: (value: Blob | null) => void
  disabled?: boolean
  onProcessing: (value: boolean) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string>()
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!value) {
      setPreview(undefined)
      return
    }
    const url = URL.createObjectURL(value)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [value])
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <ChatAvatar
          name={name || 'Agent'}
          kind="agent"
          avatarId={value === null ? null : avatarId}
          preview={preview}
          className="size-16 text-xl"
        />
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || processing}
              onClick={() => input.current?.click()}
            >
              {processing ? <Loader2 className="animate-spin" /> : <Camera />}{' '}
              {preview || (avatarId && value !== null)
                ? 'Change photo'
                : 'Add photo'}
            </Button>
            {(value || (avatarId && value !== null)) && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || processing}
                onClick={() => {
                  onChange(null)
                  setError('')
                }}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            PNG, JPEG or WebP · Up to 5 MB
          </p>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Agent photo"
        className="sr-only"
        disabled={disabled || processing}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          setProcessing(true)
          onProcessing(true)
          setError('')
          try {
            onChange(await prepareAvatar(file))
          } catch (err) {
            setError(
              err instanceof Error ? err.message : 'Could not prepare photo.',
            )
          } finally {
            setProcessing(false)
            onProcessing(false)
          }
        }}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

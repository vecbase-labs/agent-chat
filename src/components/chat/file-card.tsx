import { useEffect, useRef, useState } from 'react'
import { Download, FileImage, Loader2, X, ZoomIn } from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog'
import {
  canPreviewImage,
  filePresentation,
  fileSize,
  rasterMime,
} from '#/lib/file-presentation'
import type { Attachment } from '#/lib/types'

export function FileTypeIcon({ name }: { name: string }) {
  const { kind } = filePresentation(name)
  return (
    <img
      className="file-type-icon"
      src={`/file-icons/${kind}.webp`}
      alt=""
      aria-hidden="true"
      width={128}
      height={152}
      draggable={false}
    />
  )
}

function FileName({ name }: { name: string }) {
  const { stem, suffix } = filePresentation(name)
  return (
    <span className="file-name" title={name}>
      <span className="truncate">{stem}</span>
      <span className="shrink-0">{suffix}</span>
    </span>
  )
}

function useImagePreview(file: Attachment) {
  const element = useRef<HTMLDivElement>(null)
  const [image, setImage] = useState<{
    source: string
    thumbnail: string
  } | null>(null)
  const [failed, setFailed] = useState(false)
  const eligible = canPreviewImage(file)
  useEffect(() => {
    if (!eligible || !element.current) return
    const controller = new AbortController()
    const urls: string[] = []
    const cancelled = () => controller.signal.aborted
    let started = false
    async function load() {
      if (started) return
      started = true
      try {
        // Reuse the authenticated download route. No public URL or new permission.
        const response = await fetch(`/api/v1/files/${file.id}`, {
          signal: controller.signal,
          credentials: 'same-origin',
        })
        if (!response.ok) throw new Error('Preview unavailable')
        const blob = await response.blob()
        if (blob.size !== file.bytes || blob.size > 5 * 1024 ** 2)
          throw new Error('Preview too large')
        const mime = rasterMime(
          new Uint8Array(await blob.slice(0, 12).arrayBuffer()),
        )
        if (!mime) throw new Error('Unsupported image')
        const source = new Blob([blob], { type: mime })
        const bitmap = await createImageBitmap(source)
        try {
          if (
            !bitmap.width ||
            !bitmap.height ||
            bitmap.width > 8192 ||
            bitmap.height > 8192 ||
            bitmap.width * bitmap.height > 24_000_000
          )
            throw new Error('Preview too large')
          if (cancelled()) return
          const canvas = document.createElement('canvas')
          const scale = Math.min(1, 720 / Math.max(bitmap.width, bitmap.height))
          canvas.width = Math.max(1, Math.round(bitmap.width * scale))
          canvas.height = Math.max(1, Math.round(bitmap.height * scale))
          const context = canvas.getContext('2d')
          if (!context) throw new Error('Preview unavailable')
          context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
          const thumb = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/png'),
          )
          if (cancelled()) return
          if (!thumb) throw new Error('Preview unavailable')
          urls.push(URL.createObjectURL(source), URL.createObjectURL(thumb))
          setImage({ source: urls[0], thumbnail: urls[1] })
        } finally {
          bitmap.close()
        }
      } catch {
        if (!cancelled()) setFailed(true)
      }
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect()
          void load()
        }
      },
      { rootMargin: '120px' },
    )
    observer.observe(element.current)
    return () => {
      controller.abort()
      observer.disconnect()
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [eligible, file.id, file.bytes])
  return { element, image, failed, eligible }
}

export function FileCard({ file }: { file: Attachment }) {
  const { element, image, failed, eligible } = useImagePreview(file)
  const [open, setOpen] = useState(false)
  const href = `/api/v1/files/${file.id}`
  const details = `${filePresentation(file.name).label} · ${fileSize(file.bytes)}`
  return (
    <div ref={element} className="attachment-card">
      {eligible && (
        <button
          type="button"
          className="attachment-preview"
          disabled={!image}
          aria-label={`Preview ${file.name}`}
          onClick={() => setOpen(true)}
        >
          {image ? (
            <>
              <img src={image.thumbnail} alt={file.name} />
              <span className="preview-zoom">
                <ZoomIn className="size-4" /> View image
              </span>
            </>
          ) : (
            <span className="preview-placeholder">
              {failed ? (
                <>
                  <FileImage className="size-6" /> Preview unavailable
                </>
              ) : (
                <>
                  <Loader2 className="size-5 animate-spin" /> Loading image
                </>
              )}
            </span>
          )}
        </button>
      )}
      <a
        href={href}
        download={file.name}
        className="attachment-download"
        aria-label={`Download ${file.name}, ${details}`}
      >
        <FileTypeIcon name={file.name} />
        <span className="file-details">
          <FileName name={file.name} />
          <span className="file-caption">{details}</span>
        </span>
        <span className="file-download-icon" aria-hidden="true">
          <Download className="size-4" />
        </span>
      </a>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="image-viewer max-h-[92dvh] overflow-hidden rounded-2xl p-4 sm:max-w-4xl sm:p-5">
          <DialogHeader className="pr-8 text-left">
            <DialogTitle className="truncate text-base" title={file.name}>
              {file.name}
            </DialogTitle>
            <DialogDescription>{details}</DialogDescription>
          </DialogHeader>
          {image && (
            <img
              src={image.source}
              alt={file.name}
              className="mx-auto max-h-[65dvh] max-w-full rounded-lg object-contain"
            />
          )}
          <Button
            asChild
            variant="outline"
            className="justify-self-end rounded-full"
          >
            <a href={href} download={file.name}>
              <Download /> Download original
            </a>
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function DraftFile({
  file,
  onRemove,
  disabled,
}: {
  file: Attachment
  onRemove: () => void
  disabled: boolean
}) {
  return (
    <div className="draft-file">
      <FileTypeIcon name={file.name} />
      <span className="file-details">
        <FileName name={file.name} />
        <span className="file-caption">{fileSize(file.bytes)}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 rounded-full"
        aria-label={`Remove ${file.name}`}
        onClick={onRemove}
        disabled={disabled}
      >
        <X className="size-4" />
      </Button>
    </div>
  )
}

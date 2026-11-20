import { expect, test } from 'vitest'
import {
  canPreviewImage,
  filePresentation,
  fileSize,
  rasterMime,
} from '../src/lib/file-presentation'

test('file labels preserve long-name suffixes and report small file sizes accurately', () => {
  expect(filePresentation('quarterly.report.final.PDF')).toEqual({
    kind: 'pdf',
    label: 'PDF',
    stem: 'quarterly.report.final',
    suffix: '.PDF',
  })
  expect(filePresentation('README').label).toBe('FILE')
  expect(filePresentation('notes.csv.exe').kind).toBe('file')
  expect(fileSize(90)).toBe('90 B')
  expect(fileSize(1536)).toBe('1.5 KB')
})

test('image previews exclude active formats, oversized files and spoofed raster contents', () => {
  expect(canPreviewImage({ name: 'drawing.svg', bytes: 100 })).toBe(false)
  expect(canPreviewImage({ name: 'photo.jpg', bytes: 6 * 1024 ** 2 })).toBe(
    false,
  )
  expect(canPreviewImage({ name: 'photo.PNG', bytes: 100 })).toBe(true)
  expect(
    rasterMime(new TextEncoder().encode('<svg onload="alert(1)"/>')),
  ).toBeNull()
  expect(rasterMime(new TextEncoder().encode('<html><script>'))).toBeNull()
  expect(rasterMime(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(
    'image/png',
  )
  expect(rasterMime(new Uint8Array([255, 216, 255, 224]))).toBe('image/jpeg')
  expect(rasterMime(new TextEncoder().encode('RIFFxxxxWEBP'))).toBe(
    'image/webp',
  )
  expect(rasterMime(new Uint8Array([255, 216]))).toBeNull()
})

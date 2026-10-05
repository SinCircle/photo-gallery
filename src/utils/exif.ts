import type { Photo } from '../photos'

// Formatting indexed metadata only. EXIF extraction belongs to the server.
export function photoMetadata(photo: Photo) {
  const date = photo.takenAt ? new Date(photo.takenAt) : null
  return {
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    fields: photo.exif,
  }
}

export function formatDateTime(dt: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(dt)
}

export function formatDateOnly(dt: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
  }).format(dt)
}

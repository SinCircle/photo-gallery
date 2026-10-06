import type { Photo } from '../photos'

// Formatting indexed metadata only. EXIF extraction belongs to the server.
export function photoMetadata(photo: Photo) {
  const date = photo.takenAt ? new Date(photo.takenAt) : null
  return {
    date: date && !Number.isNaN(date.getTime()) ? date : null,
    // Older indexed photos may already contain Make + a brand-prefixed Model.
    fields: photo.exif.map(field => field.label === '相机'
      ? { ...field, value: field.value.trim().replace(/^(.+?)\s+\1(?=\s|$)/i, '$1') }
      : field),
  }
}

const dateTimeFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' })
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' })

export function formatDateTime(dt: Date): string { return dateTimeFormatter.format(dt) }

export function formatDateOnly(dt: Date): string {
  return dateFormatter.format(dt)
}

import exifr from 'exifr'

export type PhotoMetadata = {
  date: Date | null
  // Human-friendly key/value fields (only those available)
  fields: Array<{ label: string; value: string }>
}

function parseHttpDate(value: string | null): Date | null {
  if (!value) return null
  const dt = new Date(value)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function formatExposureTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  if (seconds >= 1) return `${seconds.toFixed(seconds < 2 ? 1 : 0)}s`
  const denom = Math.round(1 / seconds)
  if (denom > 0) return `1/${denom}s`
  return `${seconds}s`
}

export async function readShootDateTime(url: string): Promise<Date | null> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-131071' } })
    if (!response.ok) return null
    const blob = await response.blob()

    const data = await exifr.parse(blob, [
      'DateTimeOriginal',
      'CreateDate',
      'ModifyDate',
    ])

    const candidate = (data as any)?.DateTimeOriginal ??
      (data as any)?.CreateDate ??
      (data as any)?.ModifyDate

    if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) return candidate

    // Fallback for photos without EXIF datetime: try HTTP Last-Modified.
    const lastModified = parseHttpDate(response.headers.get('last-modified'))
    return lastModified
  } catch {
    return null
  }
}

export async function readPhotoMetadata(url: string): Promise<PhotoMetadata> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-131071' } })
    if (!response.ok) return { date: null, fields: [] }
    const blob = await response.blob()

    const data = await exifr.parse(blob, [
      'DateTimeOriginal',
      'CreateDate',
      'ModifyDate',
      'Make',
      'Model',
      'LensModel',
      'FNumber',
      'ExposureTime',
      'FocalLength',
      'ISO',
    ])

    const raw = data as any
    const dateCandidate: unknown = raw?.DateTimeOriginal ?? raw?.CreateDate ?? raw?.ModifyDate
    const exifDate = dateCandidate instanceof Date && !Number.isNaN(dateCandidate.getTime())
      ? dateCandidate
      : null
    const fallback = parseHttpDate(response.headers.get('last-modified'))
    const date = exifDate ?? fallback

    const fields: Array<{ label: string; value: string }> = []
    if (raw?.Make || raw?.Model) fields.push({ label: '相机', value: [ raw?.Model].filter(Boolean).join(' ') })
    if (raw?.LensModel) fields.push({ label: '镜头', value: String(raw.LensModel) })
    if (typeof raw?.FNumber === 'number') fields.push({ label: '光圈', value: `f/${raw.FNumber}` })
    if (typeof raw?.ExposureTime === 'number') {
      const t = formatExposureTime(raw.ExposureTime)
      if (t) fields.push({ label: '快门', value: t })
    }
    if (typeof raw?.FocalLength === 'number') fields.push({ label: '焦距', value: `${Math.round(raw.FocalLength)}mm` })
    if (typeof raw?.ISO === 'number') fields.push({ label: 'ISO', value: String(raw.ISO) })

    return { date, fields }
  } catch {
    return { date: null, fields: [] }
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

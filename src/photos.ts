export type PhotoMetadataField = {
  label: string
  value: string
}

export type Photo = {
  id: string
  url: string
  thumbUrl?: string
  fileName: string
  isFeatured: boolean
  date?: string | null  // ISO date string from metadata
  fields?: PhotoMetadataField[]  // Metadata fields from EXIF
}

function rawFileNameFromPath(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] ?? path
}

function fileNameFromPath(path: string): string {
  const raw = rawFileNameFromPath(path)
  return raw.startsWith('!') ? raw.slice(1) : raw
}

function isFeaturedFromPath(path: string): boolean {
  return rawFileNameFromPath(path).startsWith('!')
}

function isSafeRelativePath(p: string): boolean {
  if (!p) return false
  if (p.startsWith('/')) return false
  if (p.includes('\\')) return false
  const parts = p.split('/').filter(Boolean)
  if (parts.some((seg) => seg === '..')) return false
  return true
}

function photoUrlFromRelativePath(rel: string): string {
  // Use relative path - browser will resolve correctly based on current location
  // Works for both local (/) and GitHub Pages (/repo/)
  return `images/${rel}`
}

export async function getAllPhotos(): Promise<Photo[]> {
  try {
    const res = await fetch('images-manifest.json', { cache: 'no-store' })
    if (!res.ok) return []
    const json = (await res.json()) as { images?: unknown }
    const images = Array.isArray(json.images) ? (json.images as unknown[]) : []

    const photos: Photo[] = images
      .map((x): Photo | null => {
        // Support both old format (string) and new format (object with path & thumb)
        if (typeof x === 'string') {
          if (!isSafeRelativePath(x)) return null
          return {
            id: encodeURIComponent(x),
            url: photoUrlFromRelativePath(x),
            fileName: fileNameFromPath(x),
            isFeatured: isFeaturedFromPath(x),
            date: null,
            fields: [],
          }
        }
        
        if (typeof x === 'object' && x !== null) {
          const obj = x as Record<string, unknown>
          const pathStr = typeof obj.path === 'string' ? obj.path : ''
          const thumbStr = typeof obj.thumb === 'string' ? obj.thumb : ''
          const dateStr = typeof obj.date === 'string' ? obj.date : null
          const fieldsArr = Array.isArray(obj.fields) ? obj.fields : []
          
          if (!pathStr || !isSafeRelativePath(pathStr)) return null
          
          return {
            id: encodeURIComponent(pathStr),
            url: photoUrlFromRelativePath(pathStr),
            thumbUrl: thumbStr && isSafeRelativePath(thumbStr) ? photoUrlFromRelativePath(thumbStr) : undefined,
            fileName: fileNameFromPath(pathStr),
            isFeatured: isFeaturedFromPath(pathStr),
            date: dateStr,
            fields: fieldsArr
              .filter((f): f is Record<string, unknown> => typeof f === 'object' && f !== null)
              .map((f) => ({
                label: typeof f.label === 'string' ? f.label : '',
                value: typeof f.value === 'string' ? f.value : '',
              }))
              .filter((f) => f.label && f.value),
          }
        }
        
        return null
      })
      .filter((x): x is Photo => x !== null)

    photos.sort((a, b) => b.fileName.localeCompare(a.fileName, undefined, { numeric: true }))
    return photos
  } catch {
    return []
  }
}

export function getPhotoById(photoId: string): Photo | undefined {
  try {
    const decoded = decodeURIComponent(photoId)
    if (!isSafeRelativePath(decoded)) return undefined
    return {
      id: encodeURIComponent(decoded),
      url: photoUrlFromRelativePath(decoded),
      thumbUrl: undefined, // Will be populated by getAllPhotos if available
      fileName: fileNameFromPath(decoded),
      isFeatured: isFeaturedFromPath(decoded),
      date: null,
      fields: [],
    }
  } catch {
    return undefined
  }
}

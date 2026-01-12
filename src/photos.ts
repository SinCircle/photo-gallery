export type Photo = {
  id: string
  url: string
  fileName: string
  isFeatured: boolean
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
  // `./` keeps it working under GitHub Pages subpaths.
  return `./images/${rel}`
}

export async function getAllPhotos(): Promise<Photo[]> {
  try {
    const res = await fetch('./images-manifest.json', { cache: 'no-store' })
    if (!res.ok) return []
    const json = (await res.json()) as { images?: unknown }
    const images = Array.isArray(json.images) ? (json.images as unknown[]) : []

    const photos = images
      .filter((x): x is string => typeof x === 'string')
      .filter(isSafeRelativePath)
      .map((rel) => ({
        id: encodeURIComponent(rel),
        url: photoUrlFromRelativePath(rel),
        fileName: fileNameFromPath(rel),
        isFeatured: isFeaturedFromPath(rel),
      }))

    photos.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true }))
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
      fileName: fileNameFromPath(decoded),
      isFeatured: isFeaturedFromPath(decoded),
    }
  } catch {
    return undefined
  }
}

export type Photo = {
  id: string
  width: number
  height: number
  takenAt: string | null
  title: string
  description: string
  exif: Array<{ label: string; value: string }>
  derived: { thumb: boolean; web: boolean }
}

let knownPhotos: Photo[] | undefined
const fileOrder = new Intl.Collator(undefined, { numeric: true })
export const getKnownPhotos = () => knownPhotos

export function thumbnailUrl(photo: Photo): string {
  return `/media/thumbs/${encodeURIComponent(photo.id)}`
}

export function photoFileName(photo: Photo): string {
  return photo.id.startsWith('!') ? photo.id.slice(1) : photo.id
}

export function originalUrl(photo: Photo): string {
  return `/media/originals/${encodeURIComponent(photo.id)}`
}

export function webUrl(photo: Photo): string {
  return photo.derived.web ? `/media/web/${encodeURIComponent(photo.id)}` : originalUrl(photo)
}

export async function getAllPhotos(): Promise<Photo[]> {
  const response = await fetch('/api/photos', { cache: 'no-cache' })
  if (!response.ok) throw new Error('照片读取失败')
  const result = await response.json() as { photos: Photo[] }
  // Keep the legacy filename order (including featured filenames without !).
  // Reading the new API must not silently change gallery/navigation order.
  knownPhotos = result.photos.sort((a, b) => fileOrder.compare(photoFileName(b), photoFileName(a)))
  return knownPhotos
}

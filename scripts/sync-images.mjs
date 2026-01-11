import { readdir, mkdir, rm, copyFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const sourceDir = path.join(root, 'images')
const destDir = path.join(root, 'public', 'images')
const manifestPath = path.join(root, 'public', 'images-manifest.json')

const ALLOWED_EXT = new Set(['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'])

async function exists(p) {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

async function copyDir(src, dest) {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath)
      continue
    }

    if (entry.isFile()) {
      await mkdir(path.dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
    }
  }
}

async function listRelativeImagePaths(dir, baseDir) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listRelativeImagePaths(full, baseDir)))
      continue
    }
    if (!entry.isFile()) continue

    const ext = path.extname(entry.name).toLowerCase()
    if (!ALLOWED_EXT.has(ext)) continue

    const rel = path.relative(baseDir, full)
    // Always use forward slashes for URLs.
    out.push(rel.split(path.sep).join('/'))
  }
  return out
}

async function cleanDest(dest) {
  if (!(await exists(dest))) return
  const entries = await readdir(dest, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue
    await rm(path.join(dest, entry.name), { recursive: true, force: true })
  }
}

async function main() {
  await mkdir(sourceDir, { recursive: true })
  await mkdir(destDir, { recursive: true })

  await cleanDest(destDir)
  await copyDir(sourceDir, destDir)

  const images = await listRelativeImagePaths(sourceDir, sourceDir)
  images.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  await writeFile(manifestPath, JSON.stringify({ images }, null, 2), 'utf8')
}

export async function syncImages() {
  await main()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncImages()
}

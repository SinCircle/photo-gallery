import { readdir, mkdir, rm, copyFile, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const sourceDir = path.join(root, 'images')
const destDir = path.join(root, 'public', 'images')
const thumbSourceDir = path.join(sourceDir, 'thumbnails')
const thumbDestDir = path.join(destDir, 'thumbnails')
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

async function copyDir(src, dest, skipDirs = new Set()) {
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue
    
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, skipDirs)
      continue
    }

    if (entry.isFile()) {
      await mkdir(path.dirname(destPath), { recursive: true })
      await copyFile(srcPath, destPath)
    }
  }
}

async function listRelativeImagePaths(dir, baseDir, skipDirs = new Set()) {
  const out = []
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.gitkeep') continue
    if (skipDirs.has(entry.name)) continue
    
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listRelativeImagePaths(full, baseDir, skipDirs)))
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

async function generateThumbnails() {
  console.log('Generating thumbnails...')
  const scriptPath = path.join(sourceDir, 'generate_thumbs.py')
  
  if (!(await exists(scriptPath))) {
    console.warn('generate_thumbs.py not found, skipping thumbnail generation')
    return false
  }
  
  return new Promise((resolve) => {
    const proc = spawn('python', [scriptPath], {
      cwd: sourceDir,
      stdio: 'inherit'
    })
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log('Thumbnails generated successfully')
        resolve(true)
      } else {
        console.warn(`Thumbnail generation exited with code ${code}`)
        resolve(false)
      }
    })
    
    proc.on('error', (err) => {
      console.warn('Failed to run thumbnail generation:', err.message)
      resolve(false)
    })
  })
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

  // Generate thumbnails first
  await generateThumbnails()

  await cleanDest(destDir)
  // Copy images but skip the thumbnails directory (will copy separately)
  await copyDir(sourceDir, destDir, new Set(['thumbnails']))
  
  // Copy thumbnails if they exist
  if (await exists(thumbSourceDir)) {
    await copyDir(thumbSourceDir, thumbDestDir)
  }

  const images = await listRelativeImagePaths(sourceDir, sourceDir, new Set(['thumbnails']))
  images.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  
  // Build manifest with thumbnail info
  const manifest = {
    images: images.map(img => {
      // Calculate thumbnail path (same relative path but in thumbnails/ and .jpg extension)
      const thumbPath = `thumbnails/${img.replace(/\.[^.]+$/, '.jpg')}`
      return {
        path: img,
        thumb: thumbPath
      }
    })
  }
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
}

export async function syncImages() {
  await main()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncImages()
}

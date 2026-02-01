import { readdir, mkdir, rm, copyFile, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

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

async function extractMetadataFromThumbnail(thumbPath) {
  const scriptCode = `
import sys
import json
from PIL import Image
import piexif
from datetime import datetime

def parse_exif_datetime(dt_str):
    """Parse EXIF datetime string to ISO format."""
    try:
        if isinstance(dt_str, bytes):
            dt_str = dt_str.decode('utf-8')
        # EXIF datetime format: "YYYY:MM:DD HH:MM:SS"
        dt = datetime.strptime(dt_str, "%Y:%m:%d %H:%M:%S")
        return dt.isoformat()
    except:
        return None

def format_exposure_time(seconds):
    """Format exposure time for display."""
    if not isinstance(seconds, (int, float)) or seconds <= 0:
        return None
    if seconds >= 1:
        return f"{seconds:.1f}s" if seconds < 2 else f"{int(seconds)}s"
    denom = round(1 / seconds)
    if denom > 0:
        return f"1/{denom}s"
    return f"{seconds}s"

try:
    img_path = sys.argv[1]
    img = Image.open(img_path)
    
    result = {
        "date": None,
        "fields": []
    }
    
    # Try to load EXIF data
    try:
        exif_dict = piexif.load(img.info.get('exif', b''))
        exif_data = {}
        
        # Extract relevant EXIF fields
        if '0th' in exif_dict:
            ifd = exif_dict['0th']
            if piexif.ImageIFD.Make in ifd:
                exif_data['Make'] = ifd[piexif.ImageIFD.Make]
            if piexif.ImageIFD.Model in ifd:
                exif_data['Model'] = ifd[piexif.ImageIFD.Model]
        
        if 'Exif' in exif_dict:
            ifd = exif_dict['Exif']
            if piexif.ExifIFD.DateTimeOriginal in ifd:
                exif_data['DateTimeOriginal'] = ifd[piexif.ExifIFD.DateTimeOriginal]
            if piexif.ExifIFD.LensModel in ifd:
                exif_data['LensModel'] = ifd[piexif.ExifIFD.LensModel]
            if piexif.ExifIFD.FNumber in ifd:
                exif_data['FNumber'] = ifd[piexif.ExifIFD.FNumber]
            if piexif.ExifIFD.ExposureTime in ifd:
                exif_data['ExposureTime'] = ifd[piexif.ExifIFD.ExposureTime]
            if piexif.ExifIFD.FocalLength in ifd:
                exif_data['FocalLength'] = ifd[piexif.ExifIFD.FocalLength]
            if piexif.ExifIFD.ISOSpeedRatings in ifd:
                exif_data['ISO'] = ifd[piexif.ExifIFD.ISOSpeedRatings]
        
        # Parse datetime
        if 'DateTimeOriginal' in exif_data:
            result['date'] = parse_exif_datetime(exif_data['DateTimeOriginal'])
        
        # Build fields
        if 'Make' in exif_data or 'Model' in exif_data:
            make = exif_data.get('Make', b'').decode('utf-8') if isinstance(exif_data.get('Make'), bytes) else exif_data.get('Make', '')
            model = exif_data.get('Model', b'').decode('utf-8') if isinstance(exif_data.get('Model'), bytes) else exif_data.get('Model', '')
            camera = ' '.join(filter(None, [make, model]))
            if camera:
                result['fields'].append({"label": "相机", "value": camera})
        
        if 'LensModel' in exif_data:
            lens = exif_data['LensModel']
            if isinstance(lens, bytes):
                lens = lens.decode('utf-8')
            result['fields'].append({"label": "镜头", "value": str(lens)})
        
        if 'FNumber' in exif_data:
            fnumber = exif_data['FNumber']
            if isinstance(fnumber, tuple):
                fnumber = fnumber[0] / fnumber[1]
            result['fields'].append({"label": "光圈", "value": f"f/{fnumber}"})
        
        if 'ExposureTime' in exif_data:
            exp_time = exif_data['ExposureTime']
            if isinstance(exp_time, tuple):
                exp_time = exp_time[0] / exp_time[1]
            formatted = format_exposure_time(exp_time)
            if formatted:
                result['fields'].append({"label": "快门", "value": formatted})
        
        if 'FocalLength' in exif_data:
            focal = exif_data['FocalLength']
            if isinstance(focal, tuple):
                focal = focal[0] / focal[1]
            result['fields'].append({"label": "焦距", "value": f"{round(focal)}mm"})
        
        if 'ISO' in exif_data:
            result['fields'].append({"label": "ISO", "value": str(exif_data['ISO'])})
    
    except:
        pass  # No EXIF data or error reading it
    
    print(json.dumps(result))
    
except Exception as e:
    print(json.dumps({"date": None, "fields": []}))
`

  try {
    const { stdout } = await execFileAsync('python', ['-c', scriptCode, thumbPath])
    return JSON.parse(stdout.trim())
  } catch (err) {
    // If extraction fails, return empty metadata
    return { date: null, fields: [] }
  }
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
  
  // Build manifest with thumbnail info and metadata
  console.log('Extracting metadata from thumbnails...')
  const manifest = {
    images: await Promise.all(images.map(async (img) => {
      // Calculate thumbnail path (same relative path but in thumbnails/ and .jpg extension)
      const thumbPath = `thumbnails/${img.replace(/\.[^.]+$/, '.jpg')}`
      const thumbFullPath = path.join(sourceDir, thumbPath)
      
      // Extract metadata from thumbnail
      let metadata = { date: null, fields: [] }
      if (await exists(thumbFullPath)) {
        metadata = await extractMetadataFromThumbnail(thumbFullPath)
      }
      
      return {
        path: img,
        thumb: thumbPath,
        date: metadata.date,
        fields: metadata.fields
      }
    }))
  }
  
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log('Manifest created with metadata')
}

export async function syncImages() {
  await main()
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncImages()
}

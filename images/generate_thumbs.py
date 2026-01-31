#!/usr/bin/env python3
"""
Generate thumbnails and extract metadata for all images in the current directory.
Thumbnails are saved to a 'thumbnails' subdirectory with the same relative paths.
Metadata is saved to images-manifest.json in the parent public directory.
"""

import os
import sys
import json
from pathlib import Path
from datetime import datetime
from PIL import Image
from PIL.ExifTags import TAGS

MAX_SIZE = (720, 720)
THUMB_DIR = "thumbnails"
QUALITY = 85

def should_process(path: Path) -> bool:
    """Check if file should be processed as an image."""
    if not path.is_file():
        return False
    
    ext = path.suffix.lower()
    return ext in {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'}

def extract_metadata(img_path: Path) -> dict:
    """Extract EXIF metadata from an image."""
    metadata = {
        "date": None,
        "fields": []
    }
    
    try:
        with Image.open(img_path) as img:
            exif_data = img._getexif()
            
            if not exif_data:
                return metadata
            
            # Create a mapping of tag names
            exif = {TAGS.get(k, k): v for k, v in exif_data.items() if k in TAGS}
            
            # Extract date/time
            date_str = exif.get('DateTimeOriginal') or exif.get('DateTime') or exif.get('DateTimeDigitized')
            if date_str:
                try:
                    # Parse EXIF date format: "YYYY:MM:DD HH:MM:SS"
                    dt = datetime.strptime(date_str, '%Y:%m:%d %H:%M:%S')
                    metadata["date"] = dt.isoformat()
                except:
                    pass
            
            # Extract camera info
            make = exif.get('Make', '').strip()
            model = exif.get('Model', '').strip()
            if model:
                # Remove make from model if it's duplicated
                if make and model.startswith(make):
                    model = model[len(make):].strip()
                camera = f"{make} {model}".strip() if make else model
                if camera:
                    metadata["fields"].append({"label": "相机", "value": camera})
            
            # Extract lens info
            lens = exif.get('LensModel', '').strip()
            if lens:
                metadata["fields"].append({"label": "镜头", "value": lens})
            
            # Extract aperture
            fnumber = exif.get('FNumber')
            if fnumber:
                try:
                    if isinstance(fnumber, tuple):
                        aperture = fnumber[0] / fnumber[1] if fnumber[1] != 0 else fnumber[0]
                    else:
                        aperture = float(fnumber)
                    metadata["fields"].append({"label": "光圈", "value": f"f/{aperture:.1f}"})
                except:
                    pass
            
            # Extract exposure time
            exposure = exif.get('ExposureTime')
            if exposure:
                try:
                    if isinstance(exposure, tuple):
                        exp_val = exposure[0] / exposure[1] if exposure[1] != 0 else exposure[0]
                    else:
                        exp_val = float(exposure)
                    
                    if exp_val >= 1:
                        exp_str = f"{exp_val:.1f}s" if exp_val < 2 else f"{int(exp_val)}s"
                    else:
                        denom = round(1 / exp_val)
                        exp_str = f"1/{denom}s"
                    metadata["fields"].append({"label": "快门", "value": exp_str})
                except:
                    pass
            
            # Extract focal length
            focal = exif.get('FocalLength')
            if focal:
                try:
                    if isinstance(focal, tuple):
                        focal_val = focal[0] / focal[1] if focal[1] != 0 else focal[0]
                    else:
                        focal_val = float(focal)
                    metadata["fields"].append({"label": "焦距", "value": f"{int(round(focal_val))}mm"})
                except:
                    pass
            
            # Extract ISO
            iso = exif.get('ISOSpeedRatings') or exif.get('ISO')
            if iso:
                try:
                    metadata["fields"].append({"label": "ISO", "value": str(int(iso))})
                except:
                    pass
                    
    except Exception as e:
        print(f"Warning: Could not extract metadata from {img_path.name}: {e}", file=sys.stderr)
    
    return metadata

def generate_thumbnail(src_path: Path, dst_path: Path) -> bool:
    """Generate a thumbnail for a single image."""
    try:
        # Create destination directory if needed
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Skip if thumbnail already exists and is newer than source
        if dst_path.exists():
            src_mtime = src_path.stat().st_mtime
            dst_mtime = dst_path.stat().st_mtime
            if dst_mtime >= src_mtime:
                return True
        
        # Open and process image
        with Image.open(src_path) as img:
            # Convert RGBA to RGB if needed
            if img.mode in ('RGBA', 'LA', 'P'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1] if img.mode in ('RGBA', 'LA') else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Create thumbnail
            img.thumbnail(MAX_SIZE, Image.Resampling.LANCZOS)
            
            # Save as JPEG
            img.save(dst_path, 'JPEG', quality=QUALITY, optimize=True)
            
        print(f"Generated: {src_path.name}")
        return True
        
    except Exception as e:
        print(f"Error {src_path.name}: {e}", file=sys.stderr)
        return False

def main():
    """Process all images in the current directory."""
    base_dir = Path.cwd()
    thumb_base = base_dir / THUMB_DIR
    
    print(f"Generating thumbnails in: {thumb_base}")
    print(f"Max size: {MAX_SIZE[0]}×{MAX_SIZE[1]}")
    print()
    
    processed = 0
    skipped = 0
    errors = 0
    
    # Collect all image information for manifest
    manifest_images = []
    
    # Walk through all subdirectories
    for root, dirs, files in os.walk(base_dir):
        root_path = Path(root)
        
        # Skip the thumbnails directory itself
        if THUMB_DIR in root_path.parts:
            continue
        
        for file in files:
            src_path = root_path / file
            
            if not should_process(src_path):
                continue
            
            # Calculate relative path and destination
            try:
                rel_path = src_path.relative_to(base_dir)
            except ValueError:
                continue
            
            # Change extension to .jpg for thumbnails
            dst_rel = rel_path.with_suffix('.jpg')
            dst_path = thumb_base / dst_rel
            
            # Check if already up-to-date
            if dst_path.exists():
                src_mtime = src_path.stat().st_mtime
                dst_mtime = dst_path.stat().st_mtime
                if dst_mtime >= src_mtime:
                    skipped += 1
                    # Still add to manifest even if skipped
                    metadata = extract_metadata(src_path)
                    manifest_images.append({
                        "path": str(rel_path).replace('\\', '/'),
                        "thumb": f"thumbnails/{str(rel_path.with_suffix('.jpg')).replace('\\', '/')}",
                        "metadata": metadata
                    })
                    continue
            
            # Generate thumbnail
            if generate_thumbnail(src_path, dst_path):
                processed += 1
                # Extract metadata
                metadata = extract_metadata(src_path)
                manifest_images.append({
                    "path": str(rel_path).replace('\\', '/'),
                    "thumb": f"thumbnails/{str(rel_path.with_suffix('.jpg')).replace('\\', '/')}",
                    "metadata": metadata
                })
            else:
                errors += 1
    
    # Write manifest to public directory
    # Navigate up to the parent directory, then to public
    try:
        public_dir = base_dir.parent / 'public'
        manifest_path = public_dir / 'images-manifest.json'
        
        # Ensure public directory exists
        public_dir.mkdir(exist_ok=True)
        
        manifest = {
            "images": manifest_images
        }
        
        with open(manifest_path, 'w', encoding='utf-8') as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        
        print()
        print(f"Manifest written to: {manifest_path}")
    except Exception as e:
        print(f"Error writing manifest: {e}", file=sys.stderr)
    
    print()
    print(f"Done! Processed: {processed}, Skipped: {skipped}, Errors: {errors}")

if __name__ == "__main__":
    main()

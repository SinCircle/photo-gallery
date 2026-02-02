#!/usr/bin/env python3
"""
Generate thumbnails for all images in the current directory.
Thumbnails are saved to a 'thumbnails' subdirectory with the same relative paths.
EXIF metadata is copied from original images to thumbnails.
"""

import os
import sys
from pathlib import Path
from PIL import Image, ImageFile
import piexif

MAX_SIZE = (720, 720)
THUMB_DIR = "thumbnails"
QUALITY = 85

# Allow very large images and partially downloaded files to be processed.
Image.MAX_IMAGE_PIXELS = None
ImageFile.LOAD_TRUNCATED_IMAGES = True

def should_process(path: Path) -> bool:
    """Check if file should be processed as an image."""
    if not path.is_file():
        return False
    
    ext = path.suffix.lower()
    return ext in {'.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif'}

def generate_thumbnail(src_path: Path, dst_path: Path) -> bool:
    """Generate a thumbnail for a single image and copy EXIF metadata."""
    try:
        # Create destination directory if needed
        dst_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Skip if thumbnail already exists and is newer than source
        if dst_path.exists():
            src_mtime = src_path.stat().st_mtime
            dst_mtime = dst_path.stat().st_mtime
            if dst_mtime >= src_mtime:
                return True
        
        # Read EXIF data from source image
        exif_dict = None
        try:
            exif_dict = piexif.load(str(src_path))
        except Exception:
            # Some images may not have EXIF or have invalid EXIF
            pass
        
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
            
            # Save as JPEG with EXIF metadata
            if exif_dict:
                try:
                    exif_bytes = piexif.dump(exif_dict)
                    img.save(dst_path, 'JPEG', quality=QUALITY, optimize=True, exif=exif_bytes)
                except Exception:
                    # If EXIF dump fails, save without EXIF
                    img.save(dst_path, 'JPEG', quality=QUALITY, optimize=True)
            else:
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
                    continue
            
            # Generate thumbnail
            if generate_thumbnail(src_path, dst_path):
                processed += 1
            else:
                errors += 1
    
    print()
    print(f"Done! Processed: {processed}, Skipped: {skipped}, Errors: {errors}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图片元数据日期填充脚本
检查当前目录下所有图片，如果元数据中没有日期，
则将文件的创建时间和修改时间中较小的值填入元数据
"""

import os
from pathlib import Path
from datetime import datetime
from PIL import Image
import piexif

def get_image_files(directory):
    """获取目录下所有图片文件（不包括子目录）"""
    image_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'}
    image_files = []
    
    for file in Path(directory).iterdir():
        if file.is_file() and file.suffix.lower() in image_extensions:
            image_files.append(file)
    
    return image_files

def has_date_in_exif(image_path):
    """检查图片EXIF中是否已有日期信息"""
    try:
        img = Image.open(image_path)
        exif_dict = piexif.load(img.info.get('exif', b''))
        
        # 检查常见的日期标签
        exif_ifd = exif_dict.get('Exif', {})
        zero_ifd = exif_dict.get('0th', {})
        
        # DateTimeOriginal, DateTimeDigitized, DateTime
        date_tags = [
            exif_ifd.get(piexif.ExifIFD.DateTimeOriginal),
            exif_ifd.get(piexif.ExifIFD.DateTimeDigitized),
            zero_ifd.get(piexif.ImageIFD.DateTime)
        ]
        
        # 如果任何一个日期标签存在且不为空
        return any(tag for tag in date_tags if tag)
    except Exception as e:
        print(f"  读取EXIF失败: {e}")
        return False

def get_earliest_file_time(file_path):
    """获取文件的创建时间和修改时间中较小的值"""
    stat = os.stat(file_path)
    created_time = stat.st_ctime
    modified_time = stat.st_mtime
    
    # 返回较小的时间戳
    earliest_time = min(created_time, modified_time)
    return datetime.fromtimestamp(earliest_time)

def add_date_to_exif(image_path, date_time):
    """将日期时间添加到图片的EXIF数据中"""
    try:
        img = Image.open(image_path)
        
        # 格式化日期为EXIF格式: YYYY:MM:DD HH:MM:SS
        date_str = date_time.strftime("%Y:%m:%d %H:%M:%S").encode('ascii')
        
        # 尝试加载现有EXIF，如果没有则创建新的
        try:
            exif_dict = piexif.load(img.info.get('exif', b''))
        except:
            exif_dict = {'0th': {}, 'Exif': {}, 'GPS': {}, '1st': {}, 'thumbnail': None}
        
        # 设置日期标签
        exif_dict['Exif'][piexif.ExifIFD.DateTimeOriginal] = date_str
        exif_dict['Exif'][piexif.ExifIFD.DateTimeDigitized] = date_str
        exif_dict['0th'][piexif.ImageIFD.DateTime] = date_str
        
        # 转换为字节
        exif_bytes = piexif.dump(exif_dict)
        
        # 保存图片
        img.save(image_path, exif=exif_bytes)
        return True
    except Exception as e:
        print(f"  写入EXIF失败: {e}")
        return False

def main():
    """主函数"""
    print("=" * 60)
    print("图片元数据日期填充工具")
    print("=" * 60)
    
    # 获取脚本所在目录
    script_dir = Path(__file__).parent
    print(f"\n处理目录: {script_dir}\n")
    
    # 获取所有图片文件
    image_files = get_image_files(script_dir)
    
    if not image_files:
        print("未找到图片文件！")
        return
    
    print(f"找到 {len(image_files)} 个图片文件\n")
    
    processed_count = 0
    skipped_count = 0
    error_count = 0
    
    for image_file in image_files:
        print(f"处理: {image_file.name}")
        
        # 检查是否已有日期
        if has_date_in_exif(image_file):
            print(f"  ✓ 已有日期信息，跳过")
            skipped_count += 1
            continue
        
        # 获取文件时间
        file_date = get_earliest_file_time(image_file)
        print(f"  获取文件时间: {file_date.strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 添加日期到EXIF
        if add_date_to_exif(image_file, file_date):
            print(f"  ✓ 成功添加日期到元数据")
            processed_count += 1
        else:
            print(f"  ✗ 处理失败")
            error_count += 1
    
    # 打印统计
    print("\n" + "=" * 60)
    print("处理完成！")
    print(f"成功处理: {processed_count} 个")
    print(f"跳过: {skipped_count} 个")
    print(f"失败: {error_count} 个")
    print("=" * 60)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n错误: {e}")
    
    input("\n按回车键退出...")

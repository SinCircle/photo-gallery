#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图片元数据复制脚本
将源图片的所有EXIF元数据复制到目标图片
先输入要被修改的图片（目标），再输入提供元数据的图片（源）
目标图片会先备份为 _origin.jpg 后缀
"""

import os
import shutil
from pathlib import Path
from PIL import Image
import piexif

def resolve_image_path(input_path, base_dir):
    """
    解析图片路径，支持文件名、相对路径和绝对路径
    
    Args:
        input_path: 用户输入的路径
        base_dir: 基准目录（脚本所在目录）
    
    Returns:
        Path对象或None
    """
    input_path = input_path.strip()
    
    # 尝试作为绝对路径
    abs_path = Path(input_path)
    if abs_path.is_absolute() and abs_path.exists():
        return abs_path
    
    # 尝试作为相对于脚本目录的路径
    rel_path = base_dir / input_path
    if rel_path.exists():
        return rel_path
    
    # 尝试作为纯文件名（在脚本目录中）
    file_path = base_dir / Path(input_path).name
    if file_path.exists():
        return file_path
    
    return None

def check_image_exists(file_path):
    """检查图片文件是否存在且为有效图片格式"""
    if not file_path or not file_path.exists():
        return False
    
    if not file_path.is_file():
        return False
    
    # 检查是否为图片文件
    image_extensions = {'.jpg', '.jpeg', '.png', '.tiff', '.tif', '.bmp'}
    return file_path.suffix.lower() in image_extensions

def get_exif_data(image_path):
    """从图片中读取EXIF数据"""
    try:
        img = Image.open(image_path)
        exif_data = img.info.get('exif')
        
        if exif_data:
            return piexif.load(exif_data)
        else:
            print(f"警告: {image_path} 没有EXIF数据")
            return None
    except Exception as e:
        print(f"读取EXIF失败: {e}")
        return None

def copy_exif_to_image(source_path, target_path):
    """将源图片的EXIF数据复制到目标图片"""
    try:
        # 读取源图片的EXIF
        exif_dict = get_exif_data(source_path)
        
        if exif_dict is None:
            return False
        
        # 打开目标图片
        target_img = Image.open(target_path)
        
        # 转换EXIF为字节
        exif_bytes = piexif.dump(exif_dict)
        
        # 保存目标图片（带新的EXIF）
        target_img.save(target_path, exif=exif_bytes)
        return True
    except Exception as e:
        print(f"复制EXIF失败: {e}")
        return False

def display_exif_summary(image_path):
    """显示图片的EXIF数据摘要"""
    try:
        img = Image.open(image_path)
        exif_dict = piexif.load(img.info.get('exif', b''))
        
        print("\n元数据摘要:")
        
        # 显示基本信息
        if '0th' in exif_dict:
            zero_ifd = exif_dict['0th']
            if piexif.ImageIFD.Make in zero_ifd:
                make = zero_ifd[piexif.ImageIFD.Make].decode('utf-8', errors='ignore')
                print(f"  相机制造商: {make}")
            if piexif.ImageIFD.Model in zero_ifd:
                model = zero_ifd[piexif.ImageIFD.Model].decode('utf-8', errors='ignore')
                print(f"  相机型号: {model}")
            if piexif.ImageIFD.DateTime in zero_ifd:
                date_time = zero_ifd[piexif.ImageIFD.DateTime].decode('utf-8', errors='ignore')
                print(f"  拍摄时间: {date_time}")
        
        # 显示EXIF信息
        if 'Exif' in exif_dict:
            exif_ifd = exif_dict['Exif']
            if piexif.ExifIFD.DateTimeOriginal in exif_ifd:
                orig_time = exif_ifd[piexif.ExifIFD.DateTimeOriginal].decode('utf-8', errors='ignore')
                print(f"  原始时间: {orig_time}")
            if piexif.ExifIFD.ExposureTime in exif_ifd:
                exposure = exif_ifd[piexif.ExifIFD.ExposureTime]
                print(f"  曝光时间: {exposure[0]}/{exposure[1]}s")
            if piexif.ExifIFD.FNumber in exif_ifd:
                fnumber = exif_ifd[piexif.ExifIFD.FNumber]
                print(f"  光圈: f/{fnumber[0]/fnumber[1]:.1f}")
        
        # 显示GPS信息
        if 'GPS' in exif_dict and exif_dict['GPS']:
            print(f"  GPS数据: 存在")
        
        # 统计总标签数
        total_tags = sum(len(ifd) for ifd in exif_dict.values() if isinstance(ifd, dict))
        print(f"  总标签数: {total_tags}")
        
    except Exception as e:
        print(f"  无法读取详细信息: {e}")

def backup_original_image(image_path):
    """备份原图为 _origin 后缀"""
    try:
        # 构建备份文件名
        stem = image_path.stem  # 文件名（不含扩展名）
        suffix = image_path.suffix  # 扩展名
        parent = image_path.parent  # 父目录
        
        backup_name = f"{stem}_origin{suffix}"
        backup_path = parent / backup_name
        
        # 如果备份文件已存在，添加序号
        counter = 1
        while backup_path.exists():
            backup_name = f"{stem}_origin_{counter}{suffix}"
            backup_path = parent / backup_name
            counter += 1
        
        # 复制文件
        shutil.copy2(image_path, backup_path)
        print(f"✓ 原图已备份为: {backup_path.name}")
        return True
    except Exception as e:
        print(f"✗ 备份失败: {e}")
        return False

def main():
    """主函数"""
    print("=" * 60)
    print("图片元数据复制工具")
    print("=" * 60)
    
    # 获取脚本所在目录
    script_dir = Path(__file__).parent
    print(f"\n工作目录: {script_dir}\n")
    
    # 输入目标图片（要被修改的）
    while True:
        target_input = input("请输入要被修改的图片（文件名/相对路径/绝对路径）: ").strip()
        if not target_input:
            print(f"✗ 输入不能为空，请重新输入")
            continue
            
        target_path = resolve_image_path(target_input, script_dir)
        
        if target_path and check_image_exists(target_path):
            print(f"✓ 找到目标图片: {target_path}")
            break
        else:
            print(f"✗ 图片不存在或不是有效的图片文件，请重新输入")
    
    print()
    
    # 输入源图片（提供元数据的）
    while True:
        source_input = input("请输入提供元数据的图片（文件名/相对路径/绝对路径）: ").strip()
        if not source_input:
            print(f"✗ 输入不能为空，请重新输入")
            continue
            
        source_path = resolve_image_path(source_input, script_dir)
        
        if target_path and source_path and source_path.resolve() == target_path.resolve():
            print(f"✗ 源图片不能与目标图片相同，请重新输入")
            continue
        
        if source_path and check_image_exists(source_path):
            print(f"✓ 找到源图片: {source_path}")
            display_exif_summary(source_path)
            break
        else:
            print(f"✗ 图片不存在或不是有效的图片文件，请重新输入")
    
    print("\n" + "-" * 60)
    print(f"\n将 '{source_path.name}' 的元数据复制到 '{target_path.name}'")
    
    # 备份原图
    print("\n正在备份原图...")
    if not backup_original_image(target_path):
        print("✗ 备份失败，操作已取消")
        return
    
    # 执行复制
    print("\n正在复制元数据...")
    if copy_exif_to_image(source_path, target_path):
        print("✓ 元数据复制成功！")
        print("\n目标图片的新元数据:")
        display_exif_summary(target_path)
    else:
        print("✗ 元数据复制失败")
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n操作已取消")
    except Exception as e:
        print(f"\n错误: {e}")
    
    input("\n按回车键退出...")

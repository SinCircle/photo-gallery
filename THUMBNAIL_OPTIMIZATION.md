# 缩略图优化说明

## 问题

之前的实现中，画廊首页虽然显示的是缩略图，但实际上客户端会先下载完整的原始图片，然后在浏览器中动态生成缩略图。这导致：

1. **带宽浪费**：用户浏览画廊时需要下载所有完整图片
2. **加载缓慢**：尤其是在移动网络或慢速连接下体验很差
3. **性能问题**：客户端需要消耗计算资源来生成缩略图

## 解决方案

现在采用**预生成缩略图**的方式：

1. **服务器端生成**：在构建时使用 Python + Pillow 预生成 720x720 的缩略图
2. **直接加载小图**：画廊首页直接加载预生成的缩略图文件（通常 50-200KB），而不是完整图片（可能数MB）
3. **按需加载原图**：只有在查看单张照片时才加载完整的高分辨率图片
4. **兼容性**：如果预生成的缩略图不存在，会自动fallback到客户端生成（保持向后兼容）

## 工作原理

### 1. 生成缩略图

运行 `images/generate_thumbs.py`：
```bash
cd images
python generate_thumbs.py
```

这会：
- 扫描 `images/` 目录下的所有图片
- 为每张图片生成最大 720x720 的缩略图
- 保存到 `images/thumbnails/` 目录（保持相同的目录结构）
- 缩略图格式统一为 JPEG（quality=85）

### 2. 同步到public

运行 `npm run build` 或 `node scripts/sync-images.mjs`：
- 自动调用 `generate_thumbs.py` 生成缩略图
- 复制原图到 `public/images/`
- 复制缩略图到 `public/images/thumbnails/`
- 生成 `public/images-manifest.json`，包含每张图片的原图和缩略图路径

### 3. 前端加载

#### 画廊页面 (gallery.ts)
```typescript
// 优先使用预生成的缩略图
const thumbUrl = await getThumbnailObjectUrl(photoUrl, photoThumbUrl)
```

#### 单张页面 (photo.ts)
- 先加载缩略图作为占位符（快速显示）
- 然后异步加载完整的高分辨率图片
- 通过淡入淡出效果平滑过渡

## manifest格式变化

### 旧格式（兼容）
```json
{
  "images": [
    "photo1.jpg",
    "subfolder/photo2.jpg"
  ]
}
```

### 新格式
```json
{
  "images": [
    {
      "path": "photo1.jpg",
      "thumb": "thumbnails/photo1.jpg"
    },
    {
      "path": "subfolder/photo2.jpg",
      "thumb": "thumbnails/subfolder/photo2.jpg"
    }
  ]
}
```

前端代码会自动兼容两种格式。

## GitHub Pages部署

新的GitHub Actions工作流 (`.github/workflows/deploy.yml`) 会：

1. 安装 Python 和 Pillow
2. 运行 `npm run build`（自动生成缩略图）
3. 部署 `dist/` 目录到 GitHub Pages

## 开发流程

### 添加新照片

1. 把照片放到 `images/` 目录
2. 运行开发服务器（会自动同步）：
   ```bash
   npm run dev
   ```
3. 刷新浏览器查看新照片

### 手动生成缩略图

如果需要单独生成缩略图：
```bash
cd images
python generate_thumbs.py
```

脚本会跳过已存在且是最新的缩略图，只处理新增或修改的图片。

## 性能对比

以一个典型的画廊页面（20张照片）为例：

**优化前**：
- 下载数据：20张 × 3-5MB = 60-100MB
- 加载时间：取决于网络速度，可能需要数分钟
- 客户端处理：需要动态生成20个缩略图

**优化后**：
- 下载数据：20张 × 50-200KB = 1-4MB
- 加载时间：通常几秒内完成
- 客户端处理：直接显示，无需额外计算

**节省带宽：约 95%+**

## 注意事项

1. **Python依赖**：本地开发和CI环境都需要安装 Pillow：
   ```bash
   pip install Pillow
   ```

2. **Git忽略**：`images/thumbnails/` 目录的内容会被git忽略，因为它是构建产物

3. **缓存**：缩略图生成脚本会检查文件修改时间，只重新生成修改过的图片

4. **格式转换**：所有缩略图统一保存为JPEG格式，即使原图是PNG或WebP

5. **HEIC支持**：如果需要处理HEIC格式，可能需要额外安装 `pillow-heif`：
   ```bash
   pip install pillow-heif
   ```

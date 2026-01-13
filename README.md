# Photo Gallery

一个极简、稳定的个人摄影展示站（Vite + TypeScript）。适合放在 GitHub Pages/任意静态托管上。

## 功能

- **画廊页**：从清单加载图片，瀑布流展示
- **单张预览**：白色相框边框 + 底部 Dock 元信息
- **EXIF 日期**：优先读取拍摄时间，并在画廊缩略图上展示
- **下载**：可选下载原图（无边框）或下载带白色边框版本
- **图片自动同步**：开发时监听 `images/`，新增/删除后刷新即可出现

## 依赖

- Node.js 20+（推荐）
- npm

## 快速开始

1) 把照片放到项目根目录的 `images/`（支持子文件夹）

支持格式：`.avif` `.gif` `.jpeg` `.jpg` `.png` `.webp`

2) 安装依赖并启动开发服务器

```bash
npm install
npm run dev
```

3) 打开开发地址（Vite 默认）

- http://localhost:5173

> `npm run dev` 会启动图片监听：你新增/删除图片后，刷新页面即可更新（不需要重新 build）。

## 构建与预览

```bash
npm run build
npm run preview
```

`npm run build` 会先同步图片（见下文），再进行 TypeScript 编译和 Vite 打包。

## 图片同步机制（重要）

运行时页面读取 `public/images-manifest.json` 来获取图片列表。

- `scripts/sync-images.mjs`
	- 把 `images/` 复制到 `public/images/`
	- **自动生成缩略图**：调用 `images/generate_thumbs.py` 预生成缩略图到 `images/thumbnails/`
	- 生成 `public/images-manifest.json`（包含原图和缩略图路径）
- `scripts/watch-images.mjs`
	- 开发时监听 `images/`，变更后自动触发同步

**缩略图优化**：为了在画廊首页只加载小缩略图（而非完整图片），现在会：
1. 使用 Python 脚本在服务器端预生成 720x720 的缩略图
2. 缩略图保存在 `images/thumbnails/` 并复制到 `public/images/thumbnails/`
3. 前端优先加载预生成的缩略图，失败时才在客户端动态生成
4. 只有在查看单张照片时才加载完整图片

**依赖**：需要安装 Python 和 Pillow 库来生成缩略图：
```bash
pip install Pillow
```

通常你只需要维护 `images/`；`public/images/`、`images/thumbnails/` 和 `public/images-manifest.json` 属于构建产物。

## 个性化配置

在 `src/config.ts` 可以调整：

- `previewFrameCss`：预览页相框厚度（CSS 值）
- `downloadBorderPx`：下载（带边框版本）的边框厚度（像素）
- `stampFontFamily*`：底部信息与下载水印的字体

页面标题可在 `index.html` 里改 `<title>`。

## GitHub Pages 部署

仓库已包含 GitHub Actions 工作流（`.github/workflows/deploy.yml`），推送到 `main` 后会自动构建并发布。

1) 推送代码到 GitHub
2) 仓库 Settings → Pages → Source 选择 **GitHub Actions**
3) 等待 Actions 跑完后即可访问 Pages 地址

本项目的 `vite.config.ts` 已设置 `base: './'`，对 GitHub Pages（`/<repo>/`）更友好。

## 项目结构（简版）

- `images/`：你的原始照片（建议提交到仓库，否则 CI 构建时没有图）
- `public/images/`：同步后的静态资源（由脚本生成）
- `public/images-manifest.json`：图片清单（由脚本生成）
- `src/views/`：画廊页与单张预览页
- `scripts/`：图片同步与监听脚本

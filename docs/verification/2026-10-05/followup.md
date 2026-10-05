# 中断后收尾续验

现场核对时 HEAD 已为 `0e24b31`，包含 `7665725` 后的一次自证材料提交；工作区干净，scripts 已跟踪。此次保留应用代码，只续验完整栈、管理页和开发读图，并补充本文件、截图及 [测量记录](followup-results.json)。原有全部自证见 [report.md](report.md)。

## 事实：实现与遗留检查

- 应用代码保持 `7665725`：旧版展示风格、API 宽高固定排版、API 数据源、Regular Glass、完整照片页行为、DOM 管理页与开发媒体中间件均未修改。
- 保留横图跳过冗余比例档的旧行为。按用户独立复核，`IMG_20260327_170359` 的当地 EXIF 时间为 3 月 27 日 17:03，新版显示 3 月 27 日正确；此次没有调整日期处理。
- `git diff 7665725 -- src index.html package.json package-lock.json vite.config.ts Dockerfile .npmrc server nginx docker-compose.yml` 输出为空。
- 开始时 `git status --porcelain=v1 --untracked-files=all` 输出为空；五个实现提交之外只有已经提交的 scripts 和自证材料，没有漏提的业务代码。

## 事实：实际命令与结果

正式完整栈：

```powershell
docker info --format '{{.ServerVersion}}'
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://127.0.0.1/api/health
```

关键结论：Docker `29.6.1`；重建中实际执行 `tsc && vite build`，`18 modules transformed`，产物仍为 `index-Bq6_maVF.js` / `index-Cphv3lgJ.css`；`photogallery-gallery-1` 状态 running，端口 80；健康接口 `{"status":"ok"}`。恢复时刚启动的第一秒曾返回 502，等待 Node 就绪后健康检查通过。

管理验证使用仓库内复制库，原 `.env` 未修改：

```powershell
$env:PHOTOS_HOST_DIR = (Join-Path $PWD '.superpowers/verification/library').Replace('\','/')
docker compose -p gallery-revert-admin -f docker-compose.yml -f .superpowers/verification/admin-compose.yml up -d --build
$env:VERIFY_DEV_URL = 'http://127.0.0.1:5176'
node scripts/verify-admin.mjs
```

```text
PASS admin: wrong-password rejection; login; upload; Chinese edit/reload; delete all renditions; logout
PASS development: local Node API + Vite direct media; 44 tiles; visible images loaded
```

实际查看 `#/admin` 的 [本次截图](admin-followup.jpg)：浅灰底、旧字体、既有圆角与按钮样式，上传区和编辑区可见；没有裁切或重叠。实际上传 1000×700 测试图片、生成两种派生图、UTF-8 中文编辑并刷新、删除全部三个文件、退出均通过，复制库前后仍为 44 张。

开发读图实测：另一个终端实际启动下列命令，Vite 495ms ready，地址 5176；使用已有本机 Node API 3000，其健康正常、返回 44 张照片。

```powershell
$env:PHOTOS_DIR = Join-Path $PWD '.superpowers/verification/library'
npm run dev -- --host 127.0.0.1 --port 5176 --strictPort
```

随后停止两套 Docker 容器，禁用浏览器缓存并实际访问开发页面：

```powershell
docker compose stop
docker compose -p gallery-revert-admin -f docker-compose.yml -f .superpowers/verification/admin-compose.yml stop
$env:VERIFY_DEV_URL = 'http://127.0.0.1:5176'
node scripts/verify-admin.mjs --gallery-only
```

```text
PASS development without Docker: both gallery containers exited; 44 tiles; visible images loaded
```

浏览器实际断言 44 个 tile 以及全部首屏可见图片的 `naturalWidth > 0`；记录内 Docker 状态为 `exited/exited`，开发地址为 5176。证明开发图片确实从 Vite 读出，不依赖运行中的 Docker 图片服务。

之后再次 `docker compose up -d --build` 恢复正式栈，健康接口通过；独立管理验证项目 `down`，本次启动的 5176 Vite 进程已关闭。没有停止其他既有本机 Node/开发服务。

## 推断

本次应用源码和构建产物保持不变，因此原有 74 个后端测试、CLS=0、逐屏视觉、照片交互和玻璃空闲 rAF=0 记录仍对应当前实现；此次没有重跑这些已完成检查。Docker 停止下的浏览器读图结果直接支持开发媒体中间件不依赖 Docker。

## 待办与边界

- 已完成本次指定的三项收尾，没有剩余业务代码提交。
- 真实手机系统分享、实际相册写入及其他浏览器/物理 GPU 仍未验证；沿用原报告的边界。
- 没有 push；正式完整栈保留运行。

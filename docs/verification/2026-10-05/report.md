# 展示端回归与排版修复自证

验证日期：2026-10-05。唯一源码基准：`68e64de^`，即 `fc069c5a1144d62831c2055ac15273243637b9f8`。
被验证的应用提交：`7665725392ea30183a61456da708d2bd2d31b210`。后续自证提交只增加脚本和本目录材料。

中断后指定三项收尾的再次实测见 [followup.md](followup.md)，应用实现保持不变。

## 事实：改动

- 动手前完整读取规格，并用 `git show` 读取旧版 `src/style.css`、`src/views/gallery.ts`、`src/views/photo.ts` 和 `index.html`。展示端取回旧的手写 DOM 实现，删除 Svelte 重写。
- 首页保留旧配色、字体、圆角、阴影、间距、日期戳及文件名排序；没有添加标题、导语、标语、统计条或装饰。旧首页没有 dock，因此没有新造一个。
- 每个 `.tileMedia` 用 API 的 `width/height` 固定 `aspect-ratio`；图片直接使用原生 lazy loading，淡入只作用于图片。失败保留原尺寸 tile，不删除、不重排。
- 数据改读 `/api/photos`，缩略图、展示图、下载原图分别走 `/media/thumbs`、`/media/web`、`/media/originals`；展示图缺失时退回原图。前端不再解析 EXIF。
- 保留旧照片页的拖拽、滚轮/双指缩放、比例算法、低清先显与高清交叉淡入、缩略图模糊背景，以及完整水印下载函数；接回 Esc 和左右键。保存浮层打开时，Esc 只关闭浮层。
- 新库固定为 `@ybouane/liquidglass@1.0.3`，配置严格为 `{floating:true,cornerRadius:40,blurAmount:0}`。库的画布外观沿用原 CSS 材质和边界，内部持续 rAF 改为事件触发；WebGL 不可用、初始化失败和减少动态效果设置均有 CSS 路径。
- 管理页恢复为手写 DOM；开发期 Vite 从 `PHOTOS_DIR` 直接服务图片，生产仍由 Nginx 服务。移除旧 glass 补丁、patch-package、postinstall 和构建期 manifest 依赖。
- 该版本新 glass 包自身的 postinstall 依赖未发布的 patch-package，项目 `.npmrc` 禁用安装脚本并进入 Docker 构建，实际安装及构建通过。没有增加其他新依赖。
- `server/`、Nginx、compose 配置和原 `.env` 均未修改。上传/编辑/删除验证只操作仓库内复制的照片库；正式栈最终恢复使用原 `.env` 挂载。

## 事实：实际命令与结论

以下为实际执行的命令；省略重复重建及完整日志。

```powershell
git show 68e64de^:src/style.css
git show 68e64de^:src/views/gallery.ts
git show 68e64de^:src/views/photo.ts
git show 68e64de^:index.html
# 在 server 工作目录
npm test
# 在仓库根目录
npm run build
docker info --format '{{.ServerVersion}}'
docker compose up -d --build
node scripts/prepare-verification.mjs
node scripts/verify-gallery.mjs
node scripts/verify-screenshots.mjs
node scripts/verify-admin.mjs
node scripts/verify-admin.mjs --gallery-only
node scripts/collect-verification.mjs
```

关键结论行：

```text
Tests 74 passed (74)                       # server：8 个测试文件
tsc && vite build                         # 成功生成 dist，18 modules transformed
29.6.1                                    # Docker 守护进程可用
photogallery-gallery-1 ... Up ... 80->80    # 完整栈实际运行
{"status":"ok"}                           # /api/health
PASS gallery: CLS=0; rectangles unchanged; full scroll has 0 unloaded visible tiles
PASS fixtures: 390/700/1400px; 24 known ratios; CLS=0; 0 blank tiles
PASS glass: WebGL draws observed; idle 5s requested=0 executed=0 active=0
PASS photo: low/high fade; legacy fit cycle; wheel; drag; two-finger pinch; arrows; Esc
PASS download: original-resolution JPEG + 96px matte + stamp; mobile fallback; Web Share File (emulated)
PASS fallback: reduced motion removes renderer; unavailable WebGL retains CSS controls
PASS admin: wrong-password rejection; login; upload; Chinese edit/reload; delete all renditions; logout
PASS development without Docker: both gallery containers exited; 44 tiles; visible images loaded
PASS screenshot: cli-gallery.png; --virtual-time-budget=45000; 1440x1400
PASS screenshot: cli-photo.png; --virtual-time-budget=45000; 1440x1000
```

完整测量结果见 [results.json](results.json)。浏览器为本机 Chrome 154，CDP 无头模式；WebGL 使用 SwiftShader，证实渲染路径，未据此声称物理 GPU 表现。

### 排版、交互和管理的实际观察

| 检查 | 观察结果 |
|---|---|
| 真实照片库 | 44 个 tile；拦住所有缩略图响应记录矩形，放行后矩形完全相同；首屏到全页 6 个滚动检查点，CLS = 0 |
| 已知尺寸构造页 | 24 张，混合 400×300、300×500、1000×180、200×900；390/700/1400px 三种宽度均 CLS = 0，无未加载的可见 tile |
| 图片失败 | 人为返回 503，仍为 44 个 tile；失败格高度 258.609375px，CLS = 0 |
| 高清淡入 | 拦住高清请求时低清 opacity = 1、高清 = 0；放行后实际经历 hiReady / hiDone，高清 = 1，低清隐藏；背景地址仍为缩略图 |
| 四档比例 | 普通照片：适应→宽度→完全→适应；超宽照片：适应→高度→完全→适应。合计实际点到全部四档；沿用旧算法跳过与 contain 重复的一档 |
| 手势 | 实际鼠标拖拽移动 100×50px；滚轮 scale 0.976641→3.44307；CDP 两个触点捏合至 5.73845 |
| 键盘 | 实际输入左右键切换相邻照片，Esc 返回首页；移动保存浮层 Esc 关闭后仍留在照片页 |
| 桌面下载 | 真正下载 JPEG，4080×3056 原图输出 4272×3248，四边各 96px 白框，底部检测到 1749 个深色水印像素 |
| 移动后备 | 无 share API 时实际出现 4272×3248 保存图片和旧长按提示 |
| Web Share | 模拟 navigator.share 收到一个真实 image/jpeg File（3,972,687 bytes），文件名与尺寸生成流程保留 |
| 玻璃 | 实际观察 6 次 WebGL draw；稳定后真实等待 5 秒，rAF 请求、执行、待执行均为 0 |
| 降级 | WebGL 不可用时 CSS blur(18px) 及三个控件仍在；减少动态效果时销毁渲染器，transition = 0s；无未捕获运行时异常 |
| 管理 | 错密码拒绝、登录、1000×700 图片上传、两种派生图、中文标题描述编辑/刷新持久化、删除三个文件及退出均通过；前后库数量仍为 44 |
| 开发读图 | Vite 5173 + 本机 Node API；验证时两套本仓库容器状态均为 exited，44 格可见图片仍加载成功；普通及编码空格文件 200，越界路径 404 |

中文通过浏览器 `fetch` 的 UTF-8 JSON 提交，没有使用内联中文 curl。管理验证使用独立 compose 项目 `gallery-revert-admin`、8085 端口和仓库内复制库；完成后该项目已停止。

复跑条件：脚本使用本次 44 张照片库及 `!IMG_20260103_160706.jpg`，需要根目录和 server 的已有依赖，以及本机 Chrome（可设 `CHROME_PATH`）。管理脚本只应指向复制库：本次通过临时 compose override 将端口设为 8085、挂载 `.superpowers/verification/library`，并设置测试密码 `gallery-verification-only` 的 SHA-256。开发验证设置 `VERIFY_DEV_URL=http://127.0.0.1:5173`；`--gallery-only` 必须在两套验证容器停止后运行。CLI 旧版截图使用隔离参考页的 Vite 服务 5175；CDP 脚本自行启动参考页 5174。不要直接对正式库复跑管理写入检查。

### 逐屏视觉比对

先从 git 构建未经修改的旧源码参考页，仅在隔离验证目录为其生成 manifest、映射图片地址。与实际确认材料一起逐屏查看。下列对照图左侧为旧版，右侧为本次结果：

- [首页首屏](gallery-first.jpg)：列宽、间隔、日期戳、顺序与浅灰底沿用旧版。
- [首页中段](gallery-middle.jpg)：同一滚动比例；旧版存在空白块，修复后对应照片正常显示。
- [单张页](photo.jpg)：大图位置、底部控件几何、字体、白色玻璃材质及模糊背景沿用旧版。
- 原始确认图：[首页](target-gallery.jpg)、[单张页](target-photo.jpg)。辅助截图：[管理](admin.jpg)、[移动保存后备](mobile-save-fallback.jpg)、[减少动态效果](photo-reduced-motion.jpg)。

对照图是缩小后的 JPEG 预览；原始 PNG、下载文件和各原始测量 JSON 留在本仓库忽略目录 `.superpowers/verification/`。CLI 截图确实使用 `--virtual-time-budget=45000`；交互/CDP 测量另用真实加载完成条件，未把 CLI 的虚拟时间当作真实空闲时间。CLI 还成功生成旧版首页和单张页截图。

源数据边界：日期及 EXIF 文本现在按 API 索引显示，API 的相机字段为 Make + Model，旧客户端仅取 Model；大图按规格使用 web 派生图。没有声称这些像素/文本与原图、旧 EXIF 解析结果完全相同。

```powershell
git diff --exit-code a15767c -- server
git diff --exit-code 68e64de^ -- index.html src/main.ts src/config.ts src/utils/download.ts src/utils/dom.ts src/utils/color.ts
git diff --check
```

以上检查通过；样式只改变固定尺寸图片加载、控件库所需的同位置挂载以及减少动态效果规则，原视觉常量不变。

## 推断

在 API 宽高正确的前提下，固定格子的比例使图片解码不再改变多列布局高度；这与真实库、混合比例及失败响应实测一致。截图人工比对支持旧版视觉已恢复，但不是逐像素一致的证明，也不代表已覆盖所有浏览器和所有照片库。

## 待办与验证边界

- 实体手机的系统分享面板、真实相册写入尚未验证。已验证真实生成 File、模拟 share 调用及实际长按保存后备浮层。
- 没有在其他浏览器/物理 GPU 上重复验证。玻璃调度适配固定的 1.0.3 内部方法；升级该库需重新验证空闲 rAF 和视觉。
- 没有 push。最终正式完整栈继续运行；临时管理验证容器和验证用 Vite 服务已停止。

# 玻璃、工具条收放与帧率自证

2026-10-05。在已确认的回归实现上继续修改；视觉源码基准仍为 `68e64de^`（`fc069c5a1144d62831c2055ac15273243637b9f8`）。本报告描述这次三项反馈，前次材料保留在 [原报告](../2026-10-05/report.md) 和 [中断后收尾](../2026-10-05/followup.md)。

## 事实：改了什么

- **折射修复**：删除 `preserveMaterial()`、`source-atop` 材质覆盖，以及所有对库私有字段的访问。成功输出后，工具条关闭旧白色背景和 `backdrop-filter`，使用库实际生成的无损 PNG 作为背景；失败仍保留原 CSS 材质和控件。Regular Glass 配置只有 `{floating:true,cornerRadius:40,blurAmount:0}`。
- **公开生命周期**：库只调用公开 `LiquidGlass.init()` 和 `destroy()`。一个独立的同源渲染文档只含小块实际照片/画布像素及空面板；得到像素后立即销毁实例，编码期间也没有库的持续循环。文档随后变为透明 1×1 px，保留解析后的模块，路由退出和减少动态效果设置会移除它。[上游 API 说明](https://github.com/ybouane/liquidglass#api)。
- **闲置收放**：单张页底栏和管理页顶栏闲置 3.5 秒后变为 96×8 px 横条，隐藏全部控件；接近、点击、滚动和键盘交互恢复。原布局盒保留，只变换 `transform`，使用带过冲的原生 Web Animations。`prefers-reduced-motion` 时瞬时切换，同时使用 CSS 玻璃。
- **性能改动**：删除主页面的全树观察和每次指针移动重画；按场景几何/图源判重，缓存模糊背景。滚动/滚轮合并为结束后 240 ms 更新，拖拽按住时复用上一份折射像素，松手后更新。展开的工具条不监听全局 pointermove；照片拖拽复用布局尺寸，在尺寸或布局变化时才重测。玻璃更新和工具条闲置计时器均按最后活动时间合并，不再每个事件清除并创建计时器。
- 首页、API 数据源、日期逻辑、字体、配色常量、圆角、阴影、间距、下载函数及后端均未改动。比例冗余档跳过行为保留，没有新增可见文案或依赖。

提交分阶段进行：`4b785da` 修复公开玻璃生命周期，`4eb819e` 实现闲置工具条，本报告所在性能提交收录最终缓存、生命周期调整和量化材料。没有 push。

## 事实：实际命令与结论

```powershell
# server 工作目录
npm test
# 仓库根目录
npm run build
docker info --format '{{.ServerVersion}}'
docker compose up -d --build
$env:VERIFY_URL='http://127.0.0.1'
node scripts/verify-glass.mjs
node scripts/verify-toolbar.mjs
node scripts/verify-gallery.mjs
node scripts/verify-screenshots.mjs
node scripts/benchmark-glass.mjs
node scripts/benchmark-admin.mjs
node scripts/verify-admin.mjs
node scripts/collect-glass-verification.mjs
```

管理写入和滚动测量使用 8085 的独立复制库，启动命令如下；未对正式库进行上传/编辑/删除测试。

```powershell
$env:PHOTOS_HOST_DIR=(Join-Path (Get-Location) '.superpowers/verification/library')
docker compose -p gallery-revert-admin -f docker-compose.yml -f .superpowers/verification/admin-compose.yml up -d --build
```

关键结论：

```text
Test Files 8 passed (8); Tests 74 passed (74)
tsc && vite build; 20 modules transformed
Docker 29.6.1; /api/health {"status":"ok"}
PASS refraction: edge displacement=62px; separateDocument=true; background transparent; backdrop none
PASS public lifecycle: idle 5s rAF requested=0 executed=0 active=0; CSS fallback and reduced motion
PASS toolbar: 96x8px idle handle; approach/click/wheel restore; measured overshoot=1132.78/1100px
PASS motion: photo CLS=0; admin CLS=0; image/form rectangles unchanged; reduced-motion instantaneous
PASS gallery: CLS=0; rectangles unchanged; full scroll has 0 unloaded visible tiles
PASS fixtures: 390/700/1400px; 24 known ratios; CLS=0; 0 blank tiles
PASS photo: low/high fade; legacy fit cycle; wheel; drag; two-finger pinch; arrows; Esc
PASS download: original-resolution JPEG + 96px matte + stamp; mobile fallback; Web Share File (emulated)
PASS admin: wrong-password rejection; login; upload; Chinese edit/reload; delete all renditions; logout
PASS screenshot: --virtual-time-budget=45000
PASS performance median vs legacy: 237.073 >= 236.301 FPS; main-document long tasks=0
MEASURED management scroll: off=237.473 FPS; on=236.173 FPS; long tasks=0
PASS development without Docker: both gallery containers exited; 44 tiles; visible images loaded
```

量化数据及逐轮结果见 [measurements.md](measurements.md) 和 [results.json](results.json)。单张页真实拖拽五轮：旧版中位 **236.301 FPS**，关闭玻璃 **238.101 FPS**，开启玻璃 **237.073 FPS**；三组最大 P95 均 **4.30 ms**，各组主文档长任务均 **0 / 0 ms**。开启相对旧版约 **+0.327%**，相对当前关闭玻璃约 **−0.432%**。实际平移矩阵改变、折射图更新、开启组仍走 WebGL 均有断言。

管理页三轮滚动：关闭玻璃 **237.473 FPS**，开启玻璃 **236.173 FPS**，约低 **0.547%**；均无主文档长任务。这组数据**不能证明管理页不降帧**，因此本次性能工作不能标为所有场景全部达标。同样的滚动驱动下，主文档计时器创建次数在合并闲置计时器前为关闭 352 / 开启 376，最终为关闭 **2** / 开启 **26**；这是实际计数，不据此推断帧率必然提高。

两组最终基准均在 `index-DinQTJPb.js` 构建上实测，包含最终两套计时器的合并。只合并玻璃计时器的前一构建在旧版对照中失败，该结果仍保存在诊断记录，未作为最终构建成绩。归档脚本逐字节比较正式 Docker 实际返回的 JS/CSS 与当前 `dist`，并记录 SHA-256 和运行镜像 ID，避免把其他候选结果算到最终构建上。

### 测量方法与边界

- Chrome **154.0.8037.93**，1440×1000，无头模式。实际 WebGL renderer 为 **AMD Radeon(TM) Graphics / ANGLE D3D11**，不是凭启动参数推断 SwiftShader。
- 单张页三组每组五轮，交错、反向交错顺序，每轮强制新文档、重置比例和平移。先做同样的 -350 px 滚轮放大，确保能真正平移；再在 5 秒内以 25 ms 目标间隔发送 200 次可信 CDP 拖拽事件与 9 次滚轮事件，继续观察 2.8 秒，包括后续真实材质更新。
- 管理页两组各三轮，44 张缩略图先解码，再发送 200 次可信滚轮事件；记录滚动位置及折射图实际更新。旧视觉基准没有管理页实现，这里对比当前关闭玻璃的页面。
- FPS 根据实际 rAF 时间戳计算，另记录 P95、范围和 `PerformanceObserver` 的 ≥50 ms 长任务。这是浏览器回调频率，不等于物理显示器呈现频率；不声称统计所有浏览器进程的长任务。
- 零空闲 rAF 独立测量，未注入 FPS 采样循环：稳定后真实等待 5 秒，同时追踪整个测试浏览器的 `RequestAnimationFrame` / `FireAnimationFrame`，包括渲染子文档，均为 0。闲置后再次唤醒并改动测试图形，实际新折射图更新成功。
- 早期从“适应”比例开始的测试没有真正平移，只能作为事件/缩放诊断，不能作为拖拽验收。跨源缓存文档的两次更新停滞检查被标为失败；未拿它们冒充验收结果。[诊断记录](performance-diagnostics/) 保留不同候选和不同方法，不代表最终构建的成绩，也不据此计算严格前后性能提升。

### 折射、布局及逐屏核对

[折射无损对照](refraction-comparison.png) 左边关闭折射、右边开启：测试画布位于实际工具条背后，黑色直线发生弯曲，唯一红色标记从 y=8–13 变为 y=70，厚度 6→1 px，最大位移 62 px。没有把按钮、文字或整个工具条移动当成折射证据。[真实照片在玻璃后方](photo-behind-glass.jpg) 另通过实际比例按钮放大，未保留测试图形。

- [首页首屏](gallery-first.jpg)、[首页中段](gallery-middle.jpg)、[单张页](photo.jpg)：左为未经改动的旧源码参考，右为正式栈结果。照片墙几何、顺序、字体、日期戳及单张页布局保留；新玻璃材质是本次被点名要求的变化。
- [完整底栏](photo-expanded.jpg) / [闲置横条](photo-collapsed.jpg)：保留完整布局区域，图片矩形不变；8 ms 采样测得过冲宽度约 1132.78/1100 px。
- [管理完整栏](admin-expanded.jpg) / [管理横条](admin-collapsed.jpg) / [已登录管理页](admin-authenticated.jpg)：控件统一收放，表单矩形不变。中文提交通过浏览器 UTF-8 JSON，上传测试结束后仍为 44 张，原图及两份派生图删除均验证 404。

CLI 截图实际给了 45000 ms 虚拟时间；交互、CLS、空闲与帧率测量使用真实加载条件和真实时钟。预览 JPG 有缩放，折射对照是 PNG；原始全尺寸截图和每轮记录在本仓库忽略目录 `.superpowers/verification`。

开发期实际运行最终源码的 `npm run dev -- --host 127.0.0.1 --port 5176 --strictPort`，随后停止两套本仓库容器，执行 `$env:VERIFY_DEV_URL='http://127.0.0.1:5176'; node scripts/verify-admin.mjs --gallery-only`：两容器实测均为 `exited`，44 格，首屏图片已加载且 opacity=1，另保存了 [开发页截图](dev-without-docker.jpg)。本机 Node API 3000 仍运行；Vite 直接服务图片，无须 Docker。Vite 媒体中间件没有修改。本轮最终玻璃与全部单张页功能验收在完整 Docker 栈运行，开发验收验证图片加载。

```powershell
$env:PHOTOS_DIR=(Join-Path (Get-Location) '.superpowers/verification/library')
npm run dev -- --host 127.0.0.1 --port 5176 --strictPort
# 另一个 PowerShell 窗口
docker compose stop
docker compose -p gallery-revert-admin -f docker-compose.yml -f .superpowers/verification/admin-compose.yml stop
$env:VERIFY_DEV_URL='http://127.0.0.1:5176'
node scripts/verify-admin.mjs --gallery-only
# 测试后关闭本次 Vite、移除临时验证栈、恢复正式栈
docker compose -p gallery-revert-admin -f docker-compose.yml -f .superpowers/verification/admin-compose.yml down
docker compose up -d --build
```

```powershell
git diff --exit-code cd52169 -- server index.html src/views/gallery.ts src/photos.ts src/utils/download.ts package.json package-lock.json vite.config.ts docker-compose.yml nginx
rg -n '_rafId|_renderLoop|_captureGlassContent|glassCanvases|source-atop|MutationObserver|markChanged' src
git diff --check
```

第一条无差异，第二条在应用源码无匹配，第三条通过。渲染库自身源代码包含其内部实现；应用没有读取或调用这些私有字段，也没有补丁或全局 rAF 改写。

## 推断

按场景判重、缓存和事件合并减少了重复捕获和计时器分配；真实拖拽这组中位帧率高于旧版，支持该场景的旧版对照通过。五轮样本和一台机器不足以证明所有设备/所有交互的性能不会下降，关闭玻璃对照和管理滚动的实测差距也不允许作这种泛化。固定布局盒与 transform 收放解释了 CLS=0，已有矩形与浏览器实际记录支持这个解释。

## 待办

- **单张页旧版对照通过；当前关闭玻璃对照仍有残余差距：单张页约 −0.432%，管理滚动约 −0.547%。严格的所有场景不降帧目标尚未全部证明。** 已保留可复跑的驱动、原始记录及失败候选，未改动标准或把管理对照写为通过。
- 其他浏览器、其他 GPU 和实体手机尚未覆盖；实体系统分享面板/相册写入仍没有验证，现有 Web Share 检查是模拟接口收到真实生成的 File。

最终保留正式完整栈；临时管理验证栈及本次启动的 Vite 关闭。没有 push。

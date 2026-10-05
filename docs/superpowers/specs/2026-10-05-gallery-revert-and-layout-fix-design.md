# 展示端回归与排版引擎修复 设计规格

日期：2026-10-05
状态：已确认，待实施

> 本规格**取代** `2026-10-05-photo-gallery-rebuild-design.md` 第六节（前端）中关于
> 「Svelte 5 重写 / 深夜黑 / liquidGL 三层动效」的部分。那份文档的其余部分（架构、
> 数据模型、路由表、认证）继续有效。

---

## 一、背景

一期、二期完成了后端（索引 + 管理 API + Nginx + 容器），三期把展示端重写成了
Svelte + 深夜黑。**用户不接受三期的展示端重写**：它丢掉了原有的浅色简约风格，
加了大量文案，排版引擎还有加载跳动的毛病。

用户的结论：**回到原来的前端，在它上面做局部修复**，而不是再重做一遍。

### 原来的样子（唯一视觉标准）

从第一期镜像里跑出来的真实截图，就是验收基准：

| 页面 | 样子 |
|---|---|
| 首页 | 浅灰底（`#f4f4f4`）、照片墙、每张图左下角一个日期戳；**没有任何标题、导语、标语** |
| 单张页 | 整屏大图；底部一条细玻璃控件：`返回` / `比例：适应` / EXIF 一行 / `下载` |

---

## 二、必须复刻：旧的视觉与行为

**旧实现就是设计规范。** 源码在 git 里：

```
git show 68e64de^:src/style.css        # 全部视觉标准
git show 68e64de^:src/views/gallery.ts # 首页行为
git show 68e64de^:src/views/photo.ts   # 单张页行为
git show 68e64de^:index.html           # 字体引入
```

实施方式：把这些文件从 `68e64de^` 取回，在其上修改。

### 视觉常量（照抄，不得改动）

```css
--bg: #f4f4f4;            --surface: #ffffff;
--ink: #111111;           --ink-muted: rgba(17,17,17,.64);
--hairline: rgba(17,17,17,.12);
--glass: rgba(255,255,255,.7);
--glass-strong: rgba(255,255,255,.86);
--radius: 30px;           --radius-sm: 12px;
--shadow: 0 12px 38px rgba(0,0,0,.06);
--frame: clamp(14px, 2.2vw, 26px);
--stamp-font: 'Cinzel Decorative','Cormorant SC',ui-serif,Georgia,serif;
```

字体：`Cormorant Garamond`（正文）、`Cinzel` / `Cinzel Decorative` / `Cormorant SC`（标识与日期戳），
全部走 Google Fonts（`index.html` 已引入）。

### 单张页必须原样保留的行为

这些是用户正在用、明确说"没毛病"的功能，**一个都不许丢、不许简化**：

| 行为 | 位置 |
|---|---|
| 拖拽平移 | `photoPan` 上的指针手势 |
| 双指/滚轮缩放 | `photoZoom` |
| 比例四档循环：适应 / 高度 / 宽度 / 完全 | `FIT_ORDER` + `labelForMode` |
| 缩略图先显、原图就绪后交叉淡入 | `photoImgLow` / `photoImgHigh` + `hiReady` / `hiDone` |
| 模糊背景 | `.photoBg`（用缩略图，不用原图） |
| 下载（含水印白框） | `src/utils/download.ts`：桌面直接下载；移动端走 Web Share 存相册；不支持时给长按保存浮层 |
| 键盘：Esc 返回、左右切换 | `renderPhotoView` 内 |

---

## 三、要修的三件事

### 1. 排版引擎（核心）

**根因：旧引擎不知道每张图多大。** 它先给 `<img>` 一个透明像素，等真实图片
加载完成，容器高度才长出来。高度后到 + CSS 多列布局 = 图在一列内反复重排、
加载中留空白块、加载失败时整块被 `remove()` 再重排。

**新后端已经把根因解决了**：`GET /api/photos` 返回每张图的 `width` 和 `height`。

**修法：**

- 每个 tile 的 `.tileMedia` 用行内 `aspect-ratio: <width>/<height>` 定死高度。
  **首屏就确定整页布局，任何图片加载都不会引起位移（CLS 必须为 0）。**
- 图片用原生 `loading="lazy"`，`src` 直接指向 `/media/thumbs/<id>`。
  删掉旧的透明像素占位 + `fetch` → blob URL 那套。
- 占位态：`.tileMedia` 自身给一个和最终尺寸一致的浅色底，图片加载完成后淡入。
  **不允许出现"先空白、后长出高度"的效果。**
- 加载失败：保留占位，**不要移除 tile**（移除会引起重排）。
- `isReady` / `opacity: 0` 这类会改变布局可见性的开关一律去掉；淡入只作用于 `<img>`。
- 日期戳仍按旧样式渲染；`pickReadableInkFromBottomLeft` 的取色逻辑可以保留，
  但必须包在 try/catch 里（canvas 取像素可能失败），失败时退回旧 CSS 里的默认白色 + 阴影。

### 2. 数据源：改读新接口

- 旧版读 `images-manifest.json`（构建期生成，**没有宽高**，也没有 EXIF）。
- 改为读 `GET /api/photos`，拿 `id / width / height / takenAt / title / description / exif / derived`。
- 图片一律走 Nginx 的 `/media/`：缩略图 `/media/thumbs/<id>`，单张页大图
  `/media/web/<id>`（`derived.web` 为 false 时退回 `/media/originals/<id>`）。
- **前端不再解析 EXIF**，索引里已经给了。
- 删除对 `images-manifest.json`、`public/images/` 的全部依赖，以及为之服务的构建期脚本。

### 3. 液态玻璃：换库

- **卸掉 `liquid-gl`**（它需要 `patch-package` 打补丁才能停住渲染循环，用得不顺）。
  同时删除 `patches/liquid-gl+3.0.0.patch`、`patch-package` 依赖与 `postinstall` 脚本。
- **改用 `@ybouane/liquidglass`**（就是 `https://liquid-glass.ybouane.com/` 用的那个）。

正确的 API 形态（**不要套用 `liquid-gl` 那个 `liquidGL({refraction, bevelDepth...})` 的写法**）：

```js
// 每个玻璃元素通过 dataset.config 配置
el.dataset.config = JSON.stringify({ floating: true, cornerRadius: 40, blurAmount: 0 })

// 然后整组初始化
await LiquidGlass.init({ root, glassElements: [...] })
```

- **用它的 "Regular Glass" 预设**，参数就是上面那三个，不要自己调参。
- 应用在悬浮控件上（首页底部 dock、单张页底部控件条）。
- 必须优雅降级：库不可用 / WebGL 不可用时退回 CSS `backdrop-filter`，不能白屏或报错。
- **空闲时零开销**：不交互时不得有持续运行的 `requestAnimationFrame`。
- 必须尊重 `prefers-reduced-motion`。

---

## 四、范围与边界

**在范围内：**

- 展示端回退到旧实现并完成上述三项修复
- 管理页 `#/admin` 在旧的手写 DOM 风格里重新实现（上传 / 删除 / 编辑标题描述），
  视觉沿用旧语言，文字尽量少。后端 API 已就绪，直接用。
- 开发环境修好：`npm run dev` 必须能看到图片（现在 `/media` 被代理给了只服务
  `/api` 的 Node，全部 404）。**做法：在 `vite.config.ts` 里加一个仅开发期的中间件，
  从 `PHOTOS_DIR` 直接服务 `/media`。** 生产仍然只有 Nginx 发图，这条不进入生产构建。
  这样做的理由：开发时不必开着 Docker 才能看到图。

**不在范围内：**

- 后端 `server/` 的任何改动（API 已经够用）
- 新增功能（搜索、分类、标签等）
- 重新设计任何视觉

---

## 五、审美红线（这一节专门用来限制自由发挥）

实施者**不得**做以下任何一件事：

1. 不得新增旧版没有的文案 —— **不许出现标题、导语、标语、"xx 张照片"统计条、英文副标题**。
2. 不得改动配色、字体、圆角、阴影、间距；一切以 `68e64de^:src/style.css` 为准。
3. 不得新增装饰性元素、渐变、光晕、纹理。
4. 不得引入除 `@ybouane/liquidglass` 之外的任何新依赖。
5. 不得"顺带优化"任何未经要求的东西。

判断标准：**改动之后，首页和单张页截图应当与本文档第一节描述的目标图肉眼一致**，
唯一允许的差别是"排版不再跳动、不再有空白块"。

---

## 六、自证要求

1. `cd server && npm test` 全绿，且**不得少于 74 个**（后端不应被本次改动影响）。
2. `npm run build` 成功产出 `dist/`。
3. 起完整栈（`docker compose up -d --build`），用无头浏览器对以下页面截图，
   与目标图比对：首页首屏、首页滚动到中段、单张页。
   **`--virtual-time-budget` 给足（≥40000），否则会误判"图没加载出来"。**
4. 排版引擎的硬指标：首屏加载前后 **CLS 必须为 0**；用已知 `width`/`height`
   构造的页面，滚动全程不得出现空白块。
5. 单张页逐项验证：拖拽、缩放、四档比例、原图淡入、下载、Esc/方向键，
   每条给出实际观察结果。
6. 液态玻璃：确认 WebGL 路径生效（或如实说明退回到 `backdrop-filter`），
   并确认空闲时无持续 rAF。
7. 事实 / 推断 / 待办分开写。**不许把"应该没问题"写成"已验证"。**

---

## 七、已知陷阱（都是这次实际踩过的）

- Windows Git Bash 里用内联 `curl -d '{"title":"中文"}'` 会被编成 GBK 导致乱码，
  测中文要用 UTF-8 文件 + `--data-binary @file`。
- `docker compose up` 不会自动重建镜像，改了 Dockerfile 必须加 `--build`，
  否则跑的还是旧镜像。
- 无头浏览器截图时机太早会拍到未加载的图，必须给足 `--virtual-time-budget`。
- 本机 Docker Desktop 守护进程默认不在运行，跑 docker 前先确认 `docker info` 能通。

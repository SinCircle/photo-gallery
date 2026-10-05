# 任务书：第二期（管理端）+ 第三期（展示端重构）

工作根目录：`D:\Portable Programs\photo gallery`

---

## 一、必读上下文（动手前先完整读完）

| 文件 | 作用 |
|---|---|
| `docs/superpowers/specs/2026-10-05-photo-gallery-rebuild-design.md` | **设计文档，唯一权威**。分期范围、数据模型、路由表、视觉方向、动效分层都以它为准 |
| `docs/superpowers/plans/2026-10-05-phase1-backend-foundation.md` | 第一期实施计划。看它的代码风格、注释风格、TDD 节奏、提交粒度 |
| `server/src/**` | 第一期已实现的全部后端代码，第二期要**接着改**，不要另起一套 |

### 第一期已完成的状态（不要重做）

后端 `server/` 已实现并通过 54 个测试：

- `src/config.js` —— 唯一读 `process.env` 的地方
- `src/photos/store.js` —— 唯一碰 `index.json` 的地方（原子写 + 并发串行化）
- `src/photos/metadata.js` —— exifr 提 EXIF / sharp 提尺寸
- `src/photos/ingest.js` —— 单张摄取（移入 originals + 生成 720/1920 衍生图 + 落索引）
- `src/photos/scan.js` —— `listImageFiles()` 与 `reconcile()`
- `src/routes/health.js`、`src/routes/photos.js` —— `GET /api/health`、`GET /api/photos`
- `src/index.js` —— 导出 `createApp(cfg)`，末尾有入口判断
- `scripts/migrate.js` —— 幂等迁移脚本
- `Dockerfile`（Nginx + Node 双进程）、`supervisord.conf`、`nginx/nginx.conf`、`docker-compose.yml`

**第一期验证通过的结论**（作为你的基线）：

- `cd server && npm test` → 54 passed
- 迁移脚本把 `images/` 下 44 张导入 `D:/tmp/pg-library`，44 张全部生成两档衍生图、都有宽高/拍摄时间/EXIF
- 容器起来后 `/api/health`、`/api/photos`、`/media/thumbs/*.jpg` 全部 200

### 第一期确定的代码边界（第二期必须继续遵守）

1. `config.js` 是**唯一**读 `process.env` 的地方，其余模块从它导入。
2. `store.js` 是**唯一**接触 `index.json` 的地方。
3. 衍生路径统一用正斜杠（`joinUrlPath`），不要用 `path.join` 生成 URL 路径。
4. 路由层只做参数校验和调用，不含业务逻辑。
5. 索引损坏必须抛错（500），不能静默返回空列表。

---

## 二、本次要交付的范围

**第二期 + 第三期，全部做完。** 完成后系统处于最终形态、可直接运行。

明确**不在**范围内（设计文档 YAGNI 节已定）：相册/标签/分类、搜索/筛选/时间分组、地图、AVIF、多用户权限、分块上传。

---

## 三、执行顺序（按此顺序做，每阶段一次提交）

拆成四段，**必须按顺序**，因为后一段依赖前一段：

### Stage A —— 前端骨架换成 Svelte 5

- 引入 Svelte 5 + `@sveltejs/vite-plugin-svelte`，改造 `vite.config.ts` 与根 `package.json`
- 建立 hash 路由骨架，三个空路由：`#/`、`#/photo/:id`、`#/admin`
- 开发期 Vite dev server 需要 proxy：`/api` 与 `/media` → `http://127.0.0.1:3000`（生产由 Nginx 处理，不要改 nginx 的语义）
- 旧前端 `src/*.ts`（手写 DOM 那套：`main.ts`/`router.ts`/`views/*`/`photos.ts`/`config.ts`）在这一段整体移除或替换。`utils/` 里的东西按需保留，但**不允许**保留任何只有旧页面在用、新页面不再用的文件
- 删除对 `images-manifest.json` 与 `public/images/` 的依赖，并在 `.gitignore` / `.dockerignore` 里处理干净

### Stage B —— 后端管理 API

全部写测试（TDD：先写失败的测试再实现），风格抄第一期的 `server/test/*.test.js`。

**认证**

- `POST /api/login`，body `{password}`：`sha256(password)` 与 `cfg.adminPasswordHash` 比对，成功则签发随机 token（`crypto.randomBytes` 或 `randomUUID`），存进程内 `Set`，回 `Set-Cookie: pg_session=<token>; HttpOnly; SameSite=Lax; Path=/`
- `POST /api/logout`：作废 token 并清 cookie
- `GET /api/session`：返回 `{ authenticated: boolean }`（管理页用来判断登录态）
- 写操作中间件 `requireAuth`：未登录返回 401
- cookie 解析建议手写（解析 `req.headers.cookie`），避免为这点事加依赖

**上传**

- `POST /api/upload`，需登录，`multipart/form-data`，单文件，字段名 `file`
- **允许新增依赖**（例如 `multer`）来解析 multipart；选型你自己定，但要在提交信息里说明
- 校验扩展名（复用 `scan.js` 的白名单，必要时把它导出）与 MIME
- 命名规则按设计文档：**「时间戳_原文件名」**；文件名要清洗，去掉路径分隔符等危险字符
- 落盘后**复用 `ingestFile(cfg, {sourcePath, id})`**，不要重写衍生图逻辑
- 上传体积上限：原图最大 14.7 MB，Nginx 已设 `client_max_body_size 64m`，应用侧要能接住

**删除**

- 需登录。删除 `originals/`、`thumbs/`、`web/` 下同名文件，并从索引移除记录
- 文件不存在时不要报错

**编辑元数据**

- `PATCH /api/photo/:id`，需登录，body `{title, description}`，更新索引中的记录并返回新记录

- 所有写操作都必须走 `store.js`，不要绕过它直接写 `index.json`

### Stage C —— 管理页 `#/admin`

- 未登录显示密码输入；登录后列出全部照片，支持上传、删除、编辑标题/描述
- 画廊页 `#/` **不得出现任何指向 `/admin` 的链接或按钮**（设计文档明确要求）
- 上传要有进行中/失败反馈；原图已落盘但衍生图失败时，要如实提示（索引里 `derived` 字段会标 false），不要谎报成功

### Stage D —— 展示端（画廊 + 单张页）

**数据**

- 数据来源是 `GET /api/photos`；图片走 `/media/thumbs/<id>`、`/media/web/<id>`、`/media/originals/<id>`
- **前端不再解析 EXIF**，索引里已经给了

**画廊 `#/`**

- 平铺瀑布流；用记录里的 `width`/`height` 提前确定宽高比，**避免图片加载时布局跳动**
- 首屏用 720 缩略图
- 视觉基调「深夜黑」：背景压深，照片是画面里唯一的亮部
- 悬浮 dock 用液态玻璃

**单张页 `#/photo/:id`**

- 用 1920 网页图；展示标题、描述、EXIF 字段（label/value 直接渲染）
- 支持上一张/下一张或返回

**液态玻璃**

- 用 **liquidGL（naughtyduk/liquidGL，MIT）**，`interaction: "fluid"`
- 降级链路 WebGPU → WebGL2 → WebGL1 → CSS `backdrop-filter`，低端设备不能白屏
- ⚠️ 若该库拉不下来或不可用，**不要卡住**：用 CSS `backdrop-filter` 做一个可用的降级实现，并在总结里如实标注「liquidGL 未接入及原因」。**谎报接入是不允许的。**

**动效三层**（设计文档第六节，按此实现）

| 层 | 对象 | 实现 |
|---|---|---|
| 一 | 玻璃表面 | liquidGL `interaction: "fluid"` |
| 二 | 主要控件 | Svelte 内置 `Spring`（参数集中为全局常量） |
| 三 | 照片 tile 等海量元素 | **纯 CSS transform**，禁止逐 tile 挂 JS 弹簧 |

- **必须尊重 `prefers-reduced-motion`**，系统开启"减弱动态效果"时降级为瞬时切换
- **空闲状态零开销**：不交互时不得有持续运行的 `requestAnimationFrame`

**性能目标**（设计文档第十节）：画廊首屏约 3 MB 缩略图；单张页约 356 KB；图片请求不经过 Node。

---

## 四、硬约束

1. **只改这个仓库**，不要碰仓库外的任何目录（`D:\tmp\` 下可以建临时测试目录）。**不要 `git push`。**
2. 新增依赖必须真实 `npm install` 并把 lockfile 一起提交。
3. **不要把原图提交进仓库。**
4. 注释和用户可见文案用中文，风格对齐第一期（解释「为什么」，不复述「做了什么」）。
5. 不要破坏第一期已通过的 54 个测试。
6. `.dockerignore` 把 `images/`（297 MB）排除掉——Stage A 之后前端构建不再需要它，别让构建上下文白白传 300 MB。
7. 前端构建产物里不应再出现几百 MB 的图片（这正是当初迁出第三方托管的原因）。

---

## 五、自证要求（最重要，不可跳过）

**不许只说"已完成"。** 每一条都要给实际命令和实际输出。

必跑：

```bash
cd server && npm test          # 必须全绿，且总数 ≥ 54（新增测试只会更多）
cd .. && npm run build          # 必须成功产出 dist/
```

必做的真实验证（不是跑单元测试就算数）：

1. 建一个测试照片库：`cd server && PHOTOS_DIR=D:/tmp/pg-codex-lib ADMIN_PASSWORD_HASH=<某sha256> node scripts/migrate.js "D:/Portable Programs/photo gallery/images"`，应导入 44 张
2. 真启动后端，用 `curl` 走完整链路：
   - `GET /api/health` → `{"status":"ok"}`
   - `GET /api/photos` → 44 张
   - `POST /api/login` 正确密码 → 拿到 cookie；错误密码 → 401
   - 带 cookie `POST /api/upload` 一张真实图片 → 索引变 45 张、衍生图落盘
   - 不带 cookie 调写接口 → 401
   - `PATCH /api/photo/:id` 改标题 → 读回确认改了
   - `POST /api/delete` → 索引回到 44 张、文件被删
3. `docker build -t photo-gallery:verify .` 必须成功
4. 前端：`npm run build` 后用某种方式确认页面真的能起来并渲染出照片（例如起一个静态服务 + 后端，实际请求一次页面）

**特别注意第一期的教训**：单元测试全绿但入口/装配写错是发生过的（`src/index.js` 的入口判断曾用错 URL 形式，测试全过但 `npm start` 永远不监听）。所以**必须真的把服务跑起来点一次**，不能只信测试。

---

## 六、输出要求

- 每个 Stage 一次 `git commit`，消息用 conventional commits（`feat:` / `fix:` / `chore:` / `docs:`），中文/英文与第一期保持一致
- 全部做完后给一份总结，结构固定：
  1. **改了什么**（按 Stage）
  2. **怎么自证的**（实际命令 + 关键输出，不要粘贴大段日志，给结论行）
  3. **遗留问题 / 已知限制**（例如 liquidGL 是否真的接上了、哪些降级路径没在真实设备验证过）
  4. **事实 / 推断 / 待办** 分开写，不要把推断写成事实

---

## 七、执行纪律

- 默认直接做，不要问例行问题（这是无人值守的后台任务）
- 遇到拿不准的设计取舍：**优先服从设计文档**；文档没写的，选改动最小、最贴合第一期的做法，并在总结里说明你选了什么
- 卡住不要硬编造：如实记录卡在哪、为什么，继续推进能推进的部分

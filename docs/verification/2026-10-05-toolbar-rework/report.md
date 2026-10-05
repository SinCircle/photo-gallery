# 常驻 LiquidGlass 工具条验收记录

## 1. 结论

本轮十项在本机 Chrome/154.0.8037.93、1440×1000、DPR=1、ANGLE (AMD, AMD Radeon(TM) Graphics (0x000013C0) Direct3D11 vs_5_0 ps_5_0, D3D11) 上通过。生产页面实测资源为 `/assets/index-BR782HQ4.js`。这是一组本机有限采样结果，不是所有硬件/任意负载下的延迟上界证明。

**旧的独立帧率硬门槛仍没过**：五轮中位数 236.725805 对 237.585699 FPS，-0.361930%。断言和失败原始数据原样保留；未把差值判成噪声或放宽门槛。实现修改已停止，等待确认旧 FPS 条件是否仍与本轮十项并列。

| 序号 | 验收项 | 结果 | 原始数据与截图 |
|---|---|---|---|
| 1 | 拖动 / 滚轮 / 松手静止期像素延迟 <16ms | 过（本机实测） | 每组60次，最大 9.1 / 5.0 / 11.9ms；[逐次 JSON](latency-production.json)，[拖动](latency-drag.png)、[滚轮](latency-wheel.png)、[静止](latency-idle.png) |
| 2 | 展开与收缩折射几何 | 过（本机实测） | [原始几何与标记位移](refraction-production.json)；[展开](refraction-expanded.png)、[收缩](refraction-collapsed.png) |
| 3 | 真实约56×32胶囊，可见、可点击 | 过（本机实测） | [尺寸及点击恢复轨迹](motion-production.json)；[胶囊](collapsed-toolbar.png) |
| 4 | 非线性收放与弹性过冲 | 过（本机实测） | [连续 rAF 尺寸轨迹](motion-production.json)；[展开340ms姿态](opening-340ms.png) |
| 5 | EXIF blur + opacity 过渡 | 过（本机实测） | [逐帧 blur/opacity](motion-production.json)；[展开150ms姿态](opening-150ms.png) |
| 6 | 展开态重新排版 | 过（本机实测） | 上排 EXIF 可横向滚动，下排左侧返回/比例、右侧下载；[展开布局](expanded-layout.png) |
| 7 | 亮暗照片上的可读性 | 过（本机实测） | [实测背景亮度与材质](contrast-production.json)；[暗照片](dark-photo.png)、[亮照片](light-photo.png) |
| 8 | Regular Glass 折射与厚度 | 过（本机实测） | [标记厚度和位置变化](refraction-production.json)；[展开细节](refraction-expanded-detail.png)、[收缩细节](refraction-collapsed-detail.png) |
| 9 | 显示原图并保留交互期间延迟加载 | 过（本机实测） | [请求时序和4080×3056原图](original-load-production.json)；[按住期间](original-deferred-while-held.png)、[加载后](original-loaded.png) |
| 10 | 位置、尺寸及闲置判定 | 过（本机实测） | [2800ms规则、固定预留区、零CLS](motion-production.json)；[展开](expanded-layout.png)、[收缩](collapsed-layout.png) |

## 2. 改了什么与提交

- 一个常驻实例，公开调用 init / markChanged / destroy；背景像素画布和玻璃面板是同一个 root 的直接子元素。去掉 iframe、逐次初始化、PNG 编码/解码及 CSS URL 替换链路。无按住、折叠或尾沿去抖渲染闸门。
- 场景只绘制玻璃区域；照片按原图源坐标裁剪后采样；模糊背景缓存。仅小型输出画布使用 willReadFrequently，上游照片及大画布保持加速路径。
- 胶囊真实 width/height 变化，预留展开布局空间，收放不推移照片。单一胶囊无需胶囊间相交处理。
- EXIF 独立上排，下排按钮；文字背衬为白色0.7和24px模糊，玻璃其余区域保留实际折射。配色、字体、圆角、阴影变量延续原站。
- 改用 originalUrl，保留650ms延迟与按住期间延后；画廊、后端、nginx、依赖未改。

全部小步提交见 [commits.txt](commits.txt)，含失败实验、回退和原始证据；没有 push。当前产品源码为七个文件，逐文件哈希及服务端资源逐字节核验见 [build-production.json](build-production.json)。

## 3. 复现命令与关键原始数据

工作目录：`D:\Portable Programs\photo gallery`。需现有生产服务80端口、Chrome，44张相同测试照片。各性能命令串行执行，期间不构建、不开另一测试浏览器。

```powershell
npm run build
$env:VERIFY_URL='http://127.0.0.1'
node scripts/verify-glass-latency.mjs
node scripts/verify-toolbar-rework.mjs
node scripts/collect-toolbar-rework.mjs
node scripts/benchmark-glass.mjs       # 当前严格FPS断言退出1，原样保留
node scripts/verify-screenshots.mjs   # Chrome CLI，virtual-time-budget=45000
node scripts/report-toolbar-rework.mjs
npm --prefix server test
```

验收1由 verify-glass-latency 覆盖；2/8由 UI 的 refraction 阶段覆盖；3/4/5/6/10由 motion 覆盖；7由 photos 覆盖；9由 original 覆盖。单阶段命令例如 `node scripts/verify-toolbar-rework.mjs --phase=original`。单阶段不会自动覆盖六阶段归档。

### 像素测量方法与全部逐次采样

真实页面底部测试画布红/蓝交替，从背景 fillRect 后的 performance.now 计时；测试钩子在库向显示输出画布绘制后，把该画布中心1像素复制到独立1×1探针，再读RGBA。只有读到下一目标颜色才完成样本；计时包括复制和读回。拖动和滚轮使用可信CDP输入，并验证实际照片平移/缩放矩阵变化。静止场景先松手，之后继续60次背景变化，包含胶囊收缩后的样本。dataset只记录状态，不作为完成依据。原始JSON包含全部浮点时间戳、RGBA、输入/输出时间、矩阵及contextAttributes；这里按0.1ms展示。

| 次序 | 按住拖动 ms | 滚轮 ms | 松手静止 ms |
|---:|---:|---:|---:|
| 1 | 9.1 | 4.7 | 6.5 |
| 2 | 4.0 | 5.0 | 8.9 |
| 3 | 2.8 | 4.7 | 6.3 |
| 4 | 4.6 | 3.7 | 5.6 |
| 5 | 4.1 | 4.4 | 5.2 |
| 6 | 4.6 | 4.3 | 8.4 |
| 7 | 4.4 | 3.8 | 5.3 |
| 8 | 4.0 | 3.9 | 11.6 |
| 9 | 4.3 | 3.8 | 5.6 |
| 10 | 5.0 | 3.5 | 6.2 |
| 11 | 4.4 | 4.0 | 8.7 |
| 12 | 4.1 | 3.3 | 6.1 |
| 13 | 4.5 | 3.4 | 5.0 |
| 14 | 4.5 | 3.5 | 5.2 |
| 15 | 4.4 | 3.2 | 7.8 |
| 16 | 4.1 | 4.1 | 5.7 |
| 17 | 3.0 | 3.5 | 7.0 |
| 18 | 4.3 | 3.8 | 6.4 |
| 19 | 4.6 | 4.0 | 8.4 |
| 20 | 4.3 | 3.3 | 8.1 |
| 21 | 4.5 | 3.4 | 5.8 |
| 22 | 4.2 | 3.4 | 11.1 |
| 23 | 5.1 | 3.5 | 8.4 |
| 24 | 4.2 | 3.6 | 7.6 |
| 25 | 3.9 | 3.8 | 5.1 |
| 26 | 4.7 | 3.5 | 6.8 |
| 27 | 4.5 | 3.6 | 8.1 |
| 28 | 4.7 | 3.6 | 8.5 |
| 29 | 3.6 | 3.7 | 6.8 |
| 30 | 4.8 | 4.7 | 9.2 |
| 31 | 4.4 | 3.5 | 10.8 |
| 32 | 5.0 | 3.5 | 5.5 |
| 33 | 4.5 | 3.5 | 5.5 |
| 34 | 5.9 | 4.1 | 11.7 |
| 35 | 5.0 | 4.6 | 6.5 |
| 36 | 4.6 | 3.7 | 7.0 |
| 37 | 4.4 | 3.4 | 5.5 |
| 38 | 4.4 | 3.6 | 5.1 |
| 39 | 4.3 | 3.9 | 4.9 |
| 40 | 4.5 | 3.7 | 9.0 |
| 41 | 4.3 | 4.4 | 8.4 |
| 42 | 4.9 | 3.5 | 6.2 |
| 43 | 4.2 | 3.9 | 7.7 |
| 44 | 4.6 | 4.1 | 6.6 |
| 45 | 4.3 | 3.4 | 6.6 |
| 46 | 4.7 | 3.2 | 5.9 |
| 47 | 4.5 | 4.1 | 4.8 |
| 48 | 4.6 | 3.4 | 7.6 |
| 49 | 4.4 | 3.5 | 6.9 |
| 50 | 3.1 | 4.2 | 7.9 |
| 51 | 4.2 | 3.9 | 5.6 |
| 52 | 4.9 | 3.3 | 6.6 |
| 53 | 4.8 | 3.8 | 7.2 |
| 54 | 4.4 | 3.9 | 4.6 |
| 55 | 4.1 | 3.6 | 4.9 |
| 56 | 4.5 | 3.4 | 7.7 |
| 57 | 4.7 | 3.9 | 4.9 |
| 58 | 3.9 | 3.4 | 11.9 |
| 59 | 4.9 | 3.9 | 7.9 |
| 60 | 4.5 | 3.9 | 6.0 |

全部180次无超时、每次<16ms。[原始 JSON](latency-production.json)。静止期测试包含主动改变背景而无用户输入，因此不是“松手后补一帧”。这测量的是实际画布输出像素可读时刻，不是显示器物理扫描时刻。

旧版 `0c6ea5c` 的三场景记录：[baseline JSON](latency-baseline-three-cases.json)。

- held-pointer-drag: >1050ms（超时）, >1050ms（超时）, >1050ms（超时）
- wheel: >1050ms（超时）, >1050ms（超时）, >1050ms（超时）
- released-idle: 324.5ms, 301.4ms, 308.6ms

baseline模式应指向旧版页面：`$env:VERIFY_URL='http://127.0.0.1:5178'; node scripts/verify-glass-latency.mjs --baseline`。可在仓库内建立独立旧版工作树，不替换当前服务：

```powershell
git worktree add --detach .superpowers/verification/latency-baseline 0c6ea5c
$env:PHOTOS_DIR=(Resolve-Path .superpowers/verification/library).Path
Push-Location .superpowers/verification/latency-baseline
npm ci
npm run dev -- --host 127.0.0.1 --port 5178 --strictPort
# 在另一个终端运行上述 --baseline 命令；旧版 Vite 的 /api 代理需要现有3000端口API。
```

### 几何、动画、清晰度、原图

- 展开 760×106，收缩 56×32。输出画布两端分别800×146、96×72，四边相对玻璃扩出20px。展开标记最多位移19px，厚度12→26px；收缩标记位移9px，厚度8→1px。仅一个实例，同root直接子元素断言通过。
- cubic-bezier(.22,.8,.25,1)；展开540ms，收缩460ms并延迟80ms。实际连续轨迹：展开最大宽 773.766，收缩最小宽 52.109；有EXIF opacity/blur中间值。开头100ms延后文字淡入；080ms截图已人工查看，无文字跑出玻璃。0/80/150/240/340/440/540ms图是暂停原生动画得到的姿态；真正时序与CLS依据未暂停连续记录。
- CLS=0，预留区高度不变。prefers-reduced-motion时两端动画数均0，尺寸正确；原生玻璃实例仍保留。
- 暗/亮实际玻璃背后亮度 12.88 / 214.34；照片确实覆盖玻璃背后，未拿中性页背景替代。详见亮暗照片及局部截图。
- 原图按住阶段src=null、原图请求数=0；松手后请求数=1；加载尺寸 4080×3056，缩略图在淡入后隐藏。时间戳与请求证据见JSON。
- 2800ms自最后输入计时；按住指针、距离工具条40px内、键盘编辑保持展开。靠近、点击、滚轮、滚动、键盘唤醒；最大展开宽760，左右18px，底部max(14px,safe-area)。空闲5秒 shaderDraws=0，长任务0；库自身rAF仍常驻，符合本轮方向。

### 帧率、回归和失败实验

| 组别 | 五轮中位FPS | 交互阶段中位FPS | 最坏P95帧间隔ms | ≥50ms长任务数 |
|---|---:|---:|---:|---:|
| legacy | 237.585699 | 237.685567 | 4.30 | 0 |
| glass-off | 237.838946 | 237.890570 | 4.30 | 0 |
| glass-on | 236.725805 | 237.343669 | 4.30 | 0 |

这是独立串行测量，无并行构建。[完整五轮结果和失败断言](fps-production.json)。旧帧率严格条件没过，不影响180个像素样本各自的测量结果，也不能用像素通过来抹掉旧条件失败。此前 fps-before-gpu-output.json 测量尾段有构建干扰，仅留作历史，不作最终帧率依据。

默认GPU输出的实测有超限，保留 [dev](latency-gpu-output-dev.json) 和 [production](latency-gpu-output-production.json)，没有通过挑选其中部分样本宣称成功。当前配置改回小型输出的读友好画布后才重测得到本页180次结果；大输入画布CPU化的失败实验已显式回退。

构建通过，JS82.24kB/gzip28.19kB；后端8文件74测试通过。画廊/拖拽/滚轮/双指/比例/方向键/Esc/实际下载水印/移动分享回归已通过，见 [gallery-photo-regression.json](gallery-photo-regression.json)；这组回归在同一原图/手势实现、最终淡入时序微调之前运行。首页源码未改，最终构建另有CLI画廊截图。未声称所有回归在最终小调整后全套重跑。

Chrome CLI四张图均已生成；[cli-photo.png](cli-photo.png) 的虚拟时钟截图落在动画中间态且照片仍较低清，因此仅留作命令原始产物，不作为最终视觉验收证据。上面的CDP截图均显式等待图片、元数据、字体和动画状态后拍摄。WebGL不可用时CSS降级可用，管理登录页胶囊及CLS检查通过；未登录、未修改管理数据。

## 4. 事实 / 推断 / 待办

**事实**：本机本构建的10项检查通过；180个实际像素延迟均<16ms；旧FPS严格断言失败；失败与成功样本均保留；应用源码仅上述7文件改变；没有push。

**推断**：去掉重建/编码/去抖与指针闸门，并局部采样，解释了像素延迟的大幅下降。GPU输出的个别长读回与输出画布路径有关，但不能把全部超限都归因于驱动，也不能据一次本机测试推断所有设备的上界。Regular Glass主观质感仍以用户实机观感为准。

**待办**：旧FPS门槛是否继续并列作为硬条件尚待用户确认；若保留，当前整体任务仍有这一未达项。管理页旧的独立帧率门槛本轮未重测，不宣称通过。没有继续为追逐FPS而破坏已通过像素延迟的实现。

## 5. 需要决策

保留“新版五轮中位FPS不得低于旧版”的旧硬条件，还是以本轮十项为准并接受已测得的0.36%差值？尚未获得回答，未擅自放宽。

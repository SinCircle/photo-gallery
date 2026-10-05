# 胶囊工具条候选版本验收记录

基线 86aa2c9；最终产品代码 453f7cf。本轮整体未通过验收，未部署、未 push。
正式栈仍为 http://127.0.0.1，资源 /assets/index-BR782HQ4.js。候选生产构建在 http://127.0.0.1:5187，资源 /assets/index-B59Moql_.js，响应字节与本地 dist 相同。

## 1. 四条改动

| 改动 | 结论 | 证据 |
| --- | --- | --- |
| 去掉描边 | 没过。CSS border、edgeHighlight、fresnel、specular、shadowOpacity、chromAberration 均为 0；灰底上沿没有白线或暗线，但人工复查仍看到下沿细亮缘，不能称为完全去掉。 | [border-removed.png](border-removed.png) |
| 约 2px 材质模糊 | 过。画布阶跃响应等效高斯 σ=2.011px，与浏览器 blur(2px) 对照相同。 | [blur-2px.png](blur-2px.png) |
| 独立胶囊、共同收起 | 视觉和结构过；性能约束见下文。EXIF、返回、比例、下载均是 root 直接子元素，同一个 WebGL 实例；收起只剩一个 56×32 胶囊。1440/390/320px 宽度均不重叠、不越界。 | [宽屏](capsules-1440-detail.png)、[390px](capsules-390-detail.png)、[320px](capsules-320-detail.png)、[单点收起](single-idle-capsule.png) |
| 放慢、全部非线性 | 过。展开 810ms、收起 720ms；可见弹性过冲，EXIF 透明度和 blur 同步变化；所有有时长的 CSS 过渡及实际收放动画均非 linear，减少动态效果设置下即时完成。 | [0ms](opening-0ms.png)、[200ms](opening-200ms.png)、[400ms](opening-400ms.png)、[650ms](opening-650ms.png)、[810ms](opening-810ms.png)、[hover](hover-nonlinear.png)、[active](active-nonlinear.png) |

动画时刻截图由暂停原生动画后定位得到；实际连续帧、过冲、CLS 与时序另见 ui-candidate.json 的 motion 数据。截图并不单独证明动画时间。

## 2. 模糊常量

`src/utils/glassConfig.ts:2`：`export const GLASS_BLUR_PX = 2`，单位 CSS px。
共享实时背景先用 Canvas Gaussian blur(2px) 处理，再由各原生胶囊折射；原生 blurAmount 保持 0，避免每块胶囊重复运行六轮高斯处理。CSS 输出边缘的 0.5px 羽化也由该常量乘 .25 得到，没有第二个调节常量。
阶跃 10%–90% 宽度 5.154px，浏览器 blur(2px) 对照 5.154px。此数值测量的是原生输出画布；额外 0.5px CSS 羽化后的屏幕合成 σ 没有单独测量。

## 3. 四项回归指标

| 指标 | 实测 | 结论 |
| --- | --- | --- |
| 每次像素延迟 <16ms | held-pointer-drag：60 次，最大 15.7ms，P95 13.3ms，超标 0/60；wheel：60 次，最大 19.3ms，P95 17.9ms，超标 5/60；released-idle：60 次，最大 68.4ms，P95 45.3ms，超标 3/60；均无超时 | 没过 |
| CLS=0 | 桌面/390/320px 均 0，连续收放为 0 | 过 |
| 空闲 shader 0次/5秒 | 0 次；库原生 rAF 保留，静止时短路 | 过 |
| 画廊不动、亮暗可读 | 44 张照片的位置及文字与正式版完全相等，CLS=0；底部背景平均亮度暗 13.14、亮 214.21；图片确实覆盖工具条背后，文字有局部浅色底 | 过（本机所测宽度与照片） |

[暗图](dark-photo.png) / [暗图细节](dark-capsules.png) / [亮图](light-photo.png) / [亮图细节](light-capsules.png) / [正式画廊](gallery-baseline.png) / [候选画廊](gallery-candidate.png)。画廊验证是布局及文字相等，不声称两张 PNG 逐字节相同。

环境：Windows、Chrome 154.0.8037.93、1440×1000 DPR1、ANGLE AMD Radeon(TM) Graphics / D3D11。最终延迟测量期间没有同时构建或运行其他浏览器验收。
沿用原脚本并扩展为每个可见胶囊都必须读到新颜色才完成；读的是实际输出像素，不以 draw 调用、dataset、URL 或 rAF 计数作为完成信号。计时含读回开销，不等同于物理显示器的呈现时间。

## 4. 变更与提交

产品变化涉及单张页布局、共享闲置控制器、模糊/材质配置、直接子元素原生玻璃接入与实时背景。另有绑定 1.0.3 原始 bundle SHA256 的可复现库补丁：缓存复用、零模糊路径、透明边缘修复；dev/build 时自动应用。应用只调用 init / markChanged / destroy，不访问实例私有字段。
没有修改画廊视图、后端、nginx、.env 或旧 FPS 断言。缓冲优化的历史 RGBA 完全一致证明仅对应当时优化提交；之后 alpha 边缘属于有意改变，不以那份旧对照声称最终全图完全一致。

```text
b18e2a2 docs(glass): record capsule scope and centralize pixel blur tuning
1d35f5b feat(glass): support native sibling capsules in one persistent root
d181b18 feat(photo): separate controls into native capsules with a shared idle toggle
ad2e993 test(glass): require every visible capsule to refresh its actual pixels
d80abc0 test(capsules): preserve initial multi-panel blur latency failure
3ebce79 perf(capsules): keep multi-panel rendering and grouped pixel probes on GPU
9dd6cdf test(capsules): retain GPU blur latency and collapse resize stall
0695c27 perf(capsules): preserve native panel buffers across idle transitions
c64e840 perf(glass): Gaussian blur the shared live scene once for all capsules
f21f3fb test(capsules): preserve shared-blur GPU latency measurements
39d7f3f perf(capsules): stabilize scene allocation and read-friendly panel outputs
db13637 test(capsules): retain grouped readback and transition handoff failure
c17d2e4 perf(capsules): separate native sampling halos and smooth the shared toggle handoff
40b27c0 test(capsules): preserve non-overlapping halo latency results
cb75a6a fix(capsules): soften the shadow edge and refresh native geometry during motion
36e22c2 test(capsules): preserve mixed output experiment before reverting it
82067b3 fix(capsules): retain compact spacing and one blur control for both render paths
393b2bf perf(liquidglass): reuse native scene buffers and remove redundant uploads
40a849d test(liquidglass): prove exact output parity after native buffer optimization
af5c76c test(capsules): retain buffer-pool latency improvements and remaining outliers
85dbbfc perf(capsules): skip identity shader copies and stop rendering faded controls
b45fafc test(capsules): verify outlines blur motion narrow layout and unchanged gallery
f43f13c test(capsules): retain latency outliers and first visual audit failures
9486cb3 test(capsules): preserve requested narrow viewport through navigation
635c3bb fix(capsules): show spring overshoot after reveal and use 1.5x close timing
5555fed test(capsules): retain narrow layout and visible spring verification
1c2c074 fix(capsules): remove alpha-compositing hairline and improve dark-photo text
1f581ae test(capsules): serve candidate build without replacing accepted stack
f8a2f1b fix(capsules): remove chromatic edge fringes alongside highlights
ef76c3a fix(capsules): feather residual refractive rim from the single blur setting
7cd18e8 fix(capsules): extend viewport pixels into offscreen refraction halo
453f7cf Revert "fix(capsules): extend viewport pixels into offscreen refraction halo"
```

## 5. 事实 / 推断 / 待办 / 决策

- 事实：四项修改中描边未完全达标；三种延迟中滚轮和松手静止未达标。自动 UI 脚本通过，不覆盖人工观察到的所有边缘外观，最终人工验收优先。所有失败记录保留。
- 事实：构建成功；正式栈仍运行基线版本；仅本仓库有改动，没有 push。旧 FPS 断言和已失败原始记录与 86aa2c9 一致，此轮没有重跑或放宽。
- 推断：多胶囊输出及收放期间的绘制/读回开销可能贡献了延迟尖峰；现有数据不足以把所有尖峰归因于单一库函数或 GPU 驱动。残留亮缘的全部成因也尚未查明。
- 待办：消除剩余亮缘；解决每个可见胶囊在滚轮与收放期间的实际像素更新时间；修改后重新测量全部三种情况。未验证目标机器外的浏览器/DPR。
- 需要决策：是否继续深入修改库的合成/批量输出路径以保留全部要求；当前候选未达到部署条件。没有自行接受更宽的延迟门槛；旧 FPS 问题继续保留为既有待决事项。

## 复现

在仓库目录打开两个 PowerShell 窗口。正式栈需保持运行以提供只读 API 与图片。

```powershell
npm run build
node scripts/serve-verification-build.mjs
```

第二个窗口依次执行，禁止与构建或其他浏览器测试并行：

```powershell
$env:VERIFY_URL='http://127.0.0.1:5187'
node scripts/verify-capsules.mjs
node scripts/verify-glass-latency.mjs
node scripts/report-capsules.mjs
```

本次第一条 UI 验收通过，第二条按原 <16ms 断言返回失败。报告工具保留失败结果，不把它变成通过。

## 逐次采样（ms，展示到 0.1；未舍入原数值见 latency-candidate-failed.json）

held-pointer-drag，index 0–59：

```text
9.9, 15.7, 13.3, 9.0, 10.2, 9.6, 12.8, 9.5, 10.0, 10.5, 10.4, 8.9, 10.0, 8.8, 9.7, 8.4, 8.5, 9.1, 9.9, 8.3, 7.8, 8.8, 8.1, 8.3, 9.0, 8.9, 10.5, 8.7, 8.1, 9.2, 8.6, 14.3, 8.3, 8.1, 8.2, 8.5, 9.3, 8.8, 8.8, 8.7, 8.5, 9.0, 8.2, 7.8, 9.0, 8.3, 7.5, 7.9, 9.5, 8.7, 8.7, 8.9, 8.7, 7.8, 9.3, 9.2, 8.1, 8.3, 8.6, 7.9
```

wheel，index 0–59：

```text
10.2, 8.3, 9.2, 9.8, 8.1, 9.2, 9.1, 7.6, 8.5, 8.9, 7.9, 8.3, 8.4, 8.4, 8.9, 8.2, 8.4, 8.5, 8.0, 8.4, 8.3, 8.7, 19.3, 9.2, 9.3, 8.7, 10.2, 7.8, 17.9, 8.4, 8.1, 8.5, 9.5, 9.8, 17.4, 16.4, 7.7, 8.4, 7.7, 7.9, 9.3, 8.6, 8.7, 9.3, 8.9, 18.4, 8.4, 8.6, 7.9, 8.5, 14.7, 7.6, 8.8, 8.7, 7.9, 7.9, 8.5, 8.6, 12.0, 12.1
```

released-idle，index 0–59：

```text
9.6, 10.8, 10.3, 9.8, 10.1, 9.8, 11.4, 12.5, 9.9, 10.6, 13.0, 12.2, 10.9, 10.4, 11.3, 15.5, 15.3, 11.6, 11.6, 45.3, 68.4, 66.5, 4.8, 4.8, 5.4, 8.3, 7.1, 13.5, 7.1, 5.7, 6.5, 5.1, 5.9, 7.7, 6.3, 8.0, 6.7, 8.7, 8.9, 5.5, 7.7, 5.1, 7.7, 5.2, 7.4, 6.6, 7.1, 5.1, 5.5, 5.6, 7.6, 5.5, 7.9, 6.3, 7.5, 8.3, 5.4, 6.0, 5.6, 5.0
```

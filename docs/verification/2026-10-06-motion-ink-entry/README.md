# 2026-10-06 工具条动画、加载状态与手机布局

本轮完成于本地 5187 预览。最终参数及行为如下；构建文件与 SHA256 见 `build.json`。端口 80 的服务没有重启或替换。

## 最终行为

- 工具条宽度使用阻尼弹簧，展开 1800ms、收起 1600ms，最多 2–3 次衰减回摆。高度使用独立弹簧，展开高度越界控制在约 1px，手机两行面板不会出现过大的纵向拉伸。关键帧包含速度信息，运行时没有 JavaScript 物理循环。
- 初次出现等待玻璃画布真正完成绘制，再一起显示胶囊及加载动画。材质淡入与模糊持续 1400ms；上浮从 14px 开始，用独立的 1100ms 弹簧和轻微回弹。展开文字的模糊也单独延长至 1400ms；收起文字保持 672ms。
- 展开、收起、加载图标与下载文字之间用模糊衔接。加载完成出现“下载”也包含 840ms 过渡，中途反向切换从当前画面继续。比例文字按用户要求直接更新，不额外模糊。
- 修正文字越过胶囊边缘：LiquidGlass 初始化写入的内联 `overflow: visible` 曾覆盖样式表。胶囊现在明确保持圆角裁切，入场模糊只作用于内部材质，不过滤整个外层容器；外层 CSS 阴影仍可正常绘制。
- 原图会在预览显示后自动请求。预览清晰不代表原图已就绪；加载状态持续到原图解码、显示和玻璃画面更新完成。元数据先到时允许展开，加载点移到下载位置。图片处理期间收起后，中央胶囊仍显示同一套加载动画。
- 所有加载位置复用同一实现。球径 5px，静止间距 14px；连续球的实际启动间隔 35ms，完整循环 6400ms，保持连续的位置与速度。图标退出模糊完成后才停止球的运动。
- 手机宽度不超过 560px 时显示两行：详情在上，返回、比例、下载在下。展开态材质 `blurAmount` 为 **0.4**，`zRadius` 为 **28**；收起态及桌面分别为 **0.15** 和 **14**。CSS 备用材质有对应模糊值，跨过宽度断点后立即更新。
- 中文统一使用自托管的 Noto Serif SC 600 宋体，英文原字体保留。去掉元数据的“日期、相机、光圈”等可见前缀，完整名称保留在悬停提示。相机品牌去重同时修复已有索引的显示和新照片 EXIF 拼接，显示 `HUAWEI Pura 70 Ultra`。字体来源和许可证保存在 `public/fonts/noto-serif-sc`。
- 每个文字标签根据当地背景选择纯黑或纯白，并平滑切换。阴影颜色始终与正在显示的文字颜色互补；局部阴影强度随背景连续变化，不用 display 开关突然出现。手机上下两行分别采样。阴影梯度仅覆盖相关标签，并压缩相同片段，减少首次展开时的样式计算。
- 照片打开、退出采用 680ms 非线性运动。转场期间暂停滚轮和触摸滚动对目标几何的修改；完成、中断和窗口尺寸变化后恢复输入。

## 检查与证据

检查环境为 Windows / Chrome 154 的隔离测试浏览器，包含窄屏视口与 CPU 降速模拟，不等同于真实手机测试。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 文字裁切 | 1440 / 390 / 320px，展开及收起各 6 个相位，胶囊轮廓外新增文字像素为 0 | `clipping.json`、`clipping-opening-desktop.png`、`clipping-opening-mobile.png` |
| 首帧、弹簧、颜色与滚轮 | 真实画布首帧后出现；上浮仅亚像素回弹；尺寸运动与输入交接通过 | `motion-ink-entry.json` |
| 展开文字 | 没有额外延时，40ms 已开始出现，1400ms 模糊到达 0；首次展开点击不穿透 | `text-timing.json` |
| 字体与两行布局 | 使用实际下载的 Noto Serif SC 600；两行独立背景样本得到独立字色 | `fluid-states.json`、`font-photo-mobile.png` |
| 下载 / 加载切换 | 1440 / 390 / 320px，原图等待、元信息先显示、下载处理、反向切换通过 | `loading-states.json`、`fluid-states.json` |
| 加载运动 | 3 种宽度，161 个采样相位，球径、间距和相邻延时通过 | `loading-physics.json` |
| 相机名 | 现有照片浏览器显示正确；服务端元数据 11 项测试通过 | `fluid-states.json`、`camera-mobile.png` |
| 照片转场 | 三种宽度、历史导航、放大后返回、尺寸改变、中断、减少动态效果及备用路径通过 | `transition.json` |
| 生命周期 | 静止 RAF / GL 绘制为 0；20 次往返前后均为 502 节点、210 监听器；退出无画布、动画或 RAF 残留 | `lifecycle.json` |

裁切检查比较同一暂停帧中“显示文字”和“隐藏文字”的截图，只统计圆角轮廓外的像素差异（1.5px 抗锯齿容差，通道差至少 4）。修复前同一检查能检测出 1534 个桌面外溢像素，以及窄屏的展开和收起外溢；修复后 36 个抽查相位均为 0。

首次自动展开的卡顿通过原图解码后的绘制屏障、玻璃表面预分配、字色结构提前准备与局部阴影计算优化缓解。同一照片的本地桌面记录中，展开期最大帧间隔从早期 183.7ms 降至本轮 20.9ms，没有超过 33.4ms 的间隔。390px、无 CPU 降速的记录最大 16.7ms，也没有超过 33.4ms 的间隔。4 倍 CPU 降速时仍存在长帧，本轮最大 133.7ms；这些数值是单次软件渲染测量，不是设备帧率保证。原图首次绘制的重工作被移到展开之前，而不是从整体加载流程中消失。

性能记录见 `expand-before.json`、`expand-final.json` 与 `expand-mobile-normal.json`。详细 CPU profile 留在本地 `.superpowers/verification` 中。

## 复核命令

```powershell
npm run build
npm --prefix server test -- metadata.test.js
node scripts/verify-toolbar-clipping.mjs
node scripts/verify-motion-ink-entry.mjs
node scripts/verify-fluid-states.mjs
node scripts/verify-loading-states.mjs
node scripts/verify-loading-spring.mjs
node scripts/verify-navigation-details.mjs
node scripts/verify-photo-transition.mjs
node scripts/verify-performance-details.mjs
```

最后将手机展开态 Blur Amount 从 0.3 调为 0.4 后，重做了实际参数、字体/状态切换检查和首次展开性能采样；裁切、转场与加载运动结果对应同一轮中未再修改的相关代码。

后续将手机展开态 zRadius 从 14 调为 18，并在实际页面核对手机展开、手机收起和桌面三种状态；记录与截图见 mobile-z-radius.json / mobile-z-radius.png。

最新参数进一步调整为手机展开态 zRadius 28、收缩态 14，构建通过；上述 mobile-z-radius 截图保留的是前一轮 18 的检查。

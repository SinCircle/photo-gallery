# 自适应文字与加载圆点

手机截图中浅色照片上的文字仍为白色，深色照片上的加载圆点仍为黑色，局部文字阴影正常。Chrome 的强制深色模式能复现同类表现：CSS 计算颜色正确，实际屏幕像素被再次改写。这里只验证了该复现环境，华为鸿蒙浏览器仍需真机确认。

文字保留原字体、布局、420ms 颜色渐变和局部阴影，使用零偏移、零模糊的文字阴影绘制主填充，避免强制深色模式替换字色。每个圆点使用两张只绘制一次的 1×1 黑白画布，通过现有颜色变量控制白层透明度。不会增加计时器或逐帧画布绘制。进出照片时的工具条副本保留这些画布内容。

加载圆点分别采样自己所在的区域：收起时采样中央运动轨迹，展开时采样下载按钮；手机的两行仍分别采样。不能用整条工具栏的中位亮度决定局部圆点颜色。

验证命令：

```powershell
npm run build
node scripts/verify-loading-ink.mjs
$env:INK_DARK='1'; node scripts/verify-loading-ink.mjs
Remove-Item Env:INK_DARK
$env:INK_FALLBACK='1'; node scripts/verify-loading-ink.mjs
Remove-Item Env:INK_FALLBACK
node scripts/verify-fluid-states.mjs
node scripts/verify-loading-states.mjs
node scripts/verify-photo-transition.mjs
```

结果均通过：

- 普通、强制深色、CSS 玻璃回退模式各检查 1440px 和 390px；手机使用触控、3 倍像素密度。
- 除检查 CSS 外，读取实际截图的文字像素及中央/下载加载圆点像素，覆盖浅底、深底、局部明暗反转、手机两行明暗不同。
- 字体实际使用 Noto Serif SC 600；阴影中途反向衔接误差为 0。
- 空闲时新增 RAF、WebGL 绘制和活动动画均为 0。
- 1440/390/320px 的加载状态、下载状态和照片进出过渡通过，包括历史导航、缩放后返回、缩放窗口、打断过渡和减少动态效果。

对应报告见同目录 JSON 文件。完整浏览器截图保存在本地 `.superpowers/verification/loading-ink-*-final`。

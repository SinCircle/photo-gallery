# 双指缩放跳动修复

旧逻辑在第二根手指按下时清掉 `isDragging`，意外恢复图片平移、缩放各 160ms 的 CSS 过渡。真实 CDP 触控事件复现了每次双指移动仍有两个活动过渡：图片持续追赶手指，松开一指进入拖动后会跳到过渡终点。旧逻辑还会对每根手指单独上报的位置重新选缩放锚点，不能稳定跟随双指中心平移。

修复保持整个直接触控期间无 CSS 变换过渡，并在接手正在进行的比例切换或滚轮缩放时保留当前显示位置。双指手势固定一个图片坐标锚点，同一帧合并两根手指的最新位置计算缩放与平移；松指前提交最后一帧，再平滑衔接单指拖动。取消、失焦和离开页面会清理待执行帧。

验证通过：

- `npm run build`
- `node scripts/verify-pinch-zoom.mjs`：390px、3 倍像素密度、真实双指触控。连续放大/缩小、双指平移、单指续拖、松开与取消、接手比例过渡均通过；几何误差小于 1px，触控期间变换过渡数为 0，浏览器视口倍率保持 1，图片源与可见性稳定。操作结束后 RAF、WebGL 绘制增量均为 0。
- `node scripts/verify-photo-transition.mjs`：1440/390/320px 的进入、返回、历史、缩放后返回、窗口变化、过渡打断和减少动态效果通过。
- `node scripts/verify-performance-details.mjs`：原图升级、失败回退、重试通过；20 次页面往返后节点和事件监听数量无增长，画布、活动动画和待执行 RAF 均清理完毕。

原始报告保存在本机 `.superpowers/verification/pinch-zoom-before`、`pinch-zoom`、`transition-details` 和 `performance-sweep/details`。华为鸿蒙浏览器真机效果仍需实际设备确认。

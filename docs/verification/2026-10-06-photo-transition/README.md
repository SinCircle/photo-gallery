# 首页与图片页的连续过渡

首页卡片与图片详情共用一张过渡图像。打开时从卡片原位展开，返回时从当前照片位置缩回对应卡片；位置、尺寸和圆角连续变化，背景同时交叉淡化。照片运动为 680ms，使用 `cubic-bezier(.22,.78,.18,1)` 非线性缓出曲线，背景淡化为 500ms。

返回前同步恢复首页滚动位置，因此动画终点不会在下一帧跳走。若从独立图片链接进入或已经切换照片，目标卡片不在可视区时将其滚入视野。首页已有的照片索引用于立即打开详情，原图仍在后台加载；缓存首页的网络重新验证等动画结束后才允许更新布局。

现代浏览器使用 View Transition 的共享图像过渡；API 不可用时，以 Web Animations 移动照片副本。减少动态效果时直接切换。新的导航、窗口尺寸变化和动态效果偏好变化会清理临时动画和名称。

实现参考：[Document.startViewTransition](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)、[共享图像组的 CSS 伪元素](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Selectors/::view-transition-group)。

## 验证

`npm run build`、`node scripts/verify-photo-transition.mjs` 和 `node scripts/verify-toolbar-repair.mjs` 均通过。

- 1440、390、320px 下，在已滚动 1200px 的首页分别打开和返回。逐阶段读取浏览器实际过渡图层，起点/终点位置与照片矩形的误差小于 1 CSS px，首页滚动位置保持。
- 取 0/170/340/510/680ms 五个相位检查每个方向的几何和非线性速度；保存了桌面实际截图。
- 浏览器前进后退、90ms 内快速反向导航、减少动态效果、窗口中途调整以及模拟 API 缺失均通过，临时名称和副本无残留。
- 放大照片后返回，起点与放大后的实际矩形一致。暂停首页 API 请求时，缓存页面的返回过渡仍在约 142ms 内就绪。
- 原有加载圆点、工具条展开、文字效果、窄屏操作、WebGL 回退和退出清理回归通过。浏览器异常为空。

测试浏览器为本机 Chrome；API 缺失测试为同一浏览器中的降级模拟，并非对其他浏览器的实机验证。

[打开过程截图](open.png) · [返回过程截图](close.png) · [过渡测试记录](results.json) · [工具条回归记录](toolbar-regression.json)

[本地预览](http://127.0.0.1:5187/?v=photo-transition)。未部署线上。

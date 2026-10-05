import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

const dir = 'docs/verification/2026-10-05-capsules/'
const ui = JSON.parse(await readFile('.superpowers/verification/capsules/results.json', 'utf8'))
const latency = JSON.parse(await readFile('.superpowers/verification/glass-latency/results.json', 'utf8'))
assert.equal(ui.base, 'http://127.0.0.1:5187')
assert.equal(latency.base, ui.base)
assert.equal(ui.status, 'passed')
assert.equal(latency.status, 'failed')
const html = await (await fetch(ui.base)).text()
assert.ok(html.includes(latency.servedModule))
const served = Buffer.from(await (await fetch(ui.base + latency.servedModule)).arrayBuffer())
assert.deepEqual(served, await readFile('dist' + latency.servedModule))
const oldBenchmark = execFileSync('git', ['show', '86aa2c9:scripts/benchmark-glass.mjs'])
assert.equal(oldBenchmark.toString().replaceAll('\r\n', '\n'), (await readFile('scripts/benchmark-glass.mjs', 'utf8')).replaceAll('\r\n', '\n'))
const fpsPath = 'docs/verification/2026-10-05-toolbar-rework/fps-production.json'
assert.equal(execFileSync('git', ['show', '86aa2c9:' + fpsPath]).toString().replaceAll('\r\n', '\n'), (await readFile(fpsPath, 'utf8')).replaceAll('\r\n', '\n'))
const acceptedHTML = await (await fetch('http://127.0.0.1')).text()
const acceptedModule = acceptedHTML.match(/<script[^>]+src="([^"]+)"/)?.[1]
assert.notEqual(acceptedModule, latency.servedModule)
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const commits = execFileSync('git', ['log', '--reverse', '--format=%h %s', '86aa2c9..HEAD'], { encoding: 'utf8' })
await mkdir(dir, { recursive: true })
await writeFile(dir + 'commits.txt', commits)
await writeFile(dir + 'ui-candidate.json', JSON.stringify(ui))
await writeFile(dir + 'latency-candidate-failed.json', JSON.stringify(latency, null, 2))
for (const name of await readdir('.superpowers/verification/capsules')) {
  if (name.endsWith('.png')) await copyFile('.superpowers/verification/capsules/' + name, dir + name)
}
const { structure, material, motion, photos, gallery } = ui.phases
const f = n => n.toFixed(1)
const summaries = latency.cases.map(c => ({ name: c.name, ...c.summary, overLimit: c.samples.filter(s => s.latencyMs >= 16 || s.timedOut).length }))
const audit = {
  status: 'not-accepted', sourceHead: head, candidate: ui.base, accepted: 'http://127.0.0.1', acceptedModule,
  candidateModule: latency.servedModule, candidateSHA256: createHash('sha256').update(served).digest('hex'),
  candidateMatchesDist: true, productionReplaced: false, knownFPSAssertionAndEvidenceUnchanged: true,
  visualReview: { outline: 'failed: residual thin bright rim remains in screenshots despite removing CSS border and native highlight parameters', blur: 'passed', capsules: 'passed', animation: 'passed' },
  measured: { summaries, cls: motion.cls, idleShaderDrawsInFiveSeconds: motion.idleDraws, galleryTiles: gallery.tiles, galleryGeometryAndTextEqual: gallery.exactGeometryAndTextMatch },
}
await writeFile(dir + 'acceptance.json', JSON.stringify(audit, null, 2))
const lines = [
  '# 胶囊工具条候选版本验收记录', '',
  `基线 86aa2c9；最终产品代码 ${head.slice(0, 7)}。本轮整体未通过验收，未部署、未 push。`,
  `正式栈仍为 http://127.0.0.1，资源 ${acceptedModule}。候选生产构建在 ${ui.base}，资源 ${latency.servedModule}，响应字节与本地 dist 相同。`, '',
  '## 1. 四条改动', '',
  '| 改动 | 结论 | 证据 |', '| --- | --- | --- |',
  '| 去掉描边 | 没过。CSS border、edgeHighlight、fresnel、specular、shadowOpacity、chromAberration 均为 0；灰底上沿没有白线或暗线，但人工复查仍看到下沿细亮缘，不能称为完全去掉。 | [border-removed.png](border-removed.png) |',
  `| 约 2px 材质模糊 | 过。画布阶跃响应等效高斯 σ=${material.blur.equivalentSigmaPx.toFixed(3)}px，与浏览器 blur(2px) 对照相同。 | [blur-2px.png](blur-2px.png) |`,
  '| 独立胶囊、共同收起 | 视觉和结构过；性能约束见下文。EXIF、返回、比例、下载均是 root 直接子元素，同一个 WebGL 实例；收起只剩一个 56×32 胶囊。1440/390/320px 宽度均不重叠、不越界。 | [宽屏](capsules-1440-detail.png)、[390px](capsules-390-detail.png)、[320px](capsules-320-detail.png)、[单点收起](single-idle-capsule.png) |',
  '| 放慢、全部非线性 | 过。展开 810ms、收起 720ms；可见弹性过冲，EXIF 透明度和 blur 同步变化；所有有时长的 CSS 过渡及实际收放动画均非 linear，减少动态效果设置下即时完成。 | [0ms](opening-0ms.png)、[200ms](opening-200ms.png)、[400ms](opening-400ms.png)、[650ms](opening-650ms.png)、[810ms](opening-810ms.png)、[hover](hover-nonlinear.png)、[active](active-nonlinear.png) |', '',
  '动画时刻截图由暂停原生动画后定位得到；实际连续帧、过冲、CLS 与时序另见 ui-candidate.json 的 motion 数据。截图并不单独证明动画时间。', '',
  '## 2. 模糊常量', '',
  '`src/utils/glassConfig.ts:2`：`export const GLASS_BLUR_PX = 2`，单位 CSS px。',
  '共享实时背景先用 Canvas Gaussian blur(2px) 处理，再由各原生胶囊折射；原生 blurAmount 保持 0，避免每块胶囊重复运行六轮高斯处理。CSS 输出边缘的 0.5px 羽化也由该常量乘 .25 得到，没有第二个调节常量。',
  `阶跃 10%–90% 宽度 ${material.blur.edgeWidthPx.toFixed(3)}px，浏览器 blur(2px) 对照 ${material.blur.referenceEdgeWidthPx.toFixed(3)}px。此数值测量的是原生输出画布；额外 0.5px CSS 羽化后的屏幕合成 σ 没有单独测量。`, '',
  '## 3. 四项回归指标', '',
  '| 指标 | 实测 | 结论 |', '| --- | --- | --- |',
  `| 每次像素延迟 <16ms | ${summaries.map(c => `${c.name}：60 次，最大 ${f(c.maxMs)}ms，P95 ${f(c.p95Ms)}ms，超标 ${c.overLimit}/60`).join('；')}；均无超时 | 没过 |`,
  `| CLS=0 | 桌面/390/320px 均 0，连续收放为 ${motion.cls} | 过 |`,
  `| 空闲 shader 0次/5秒 | ${motion.idleDraws} 次；库原生 rAF 保留，静止时短路 | 过 |`,
  `| 画廊不动、亮暗可读 | ${gallery.tiles} 张照片的位置及文字与正式版完全相等，CLS=0；底部背景平均亮度暗 ${photos.photos[0].backgroundLuma.toFixed(2)}、亮 ${photos.photos[1].backgroundLuma.toFixed(2)}；图片确实覆盖工具条背后，文字有局部浅色底 | 过（本机所测宽度与照片） |`, '',
  '[暗图](dark-photo.png) / [暗图细节](dark-capsules.png) / [亮图](light-photo.png) / [亮图细节](light-capsules.png) / [正式画廊](gallery-baseline.png) / [候选画廊](gallery-candidate.png)。画廊验证是布局及文字相等，不声称两张 PNG 逐字节相同。', '',
  '环境：Windows、Chrome 154.0.8037.93、1440×1000 DPR1、ANGLE AMD Radeon(TM) Graphics / D3D11。最终延迟测量期间没有同时构建或运行其他浏览器验收。',
  '沿用原脚本并扩展为每个可见胶囊都必须读到新颜色才完成；读的是实际输出像素，不以 draw 调用、dataset、URL 或 rAF 计数作为完成信号。计时含读回开销，不等同于物理显示器的呈现时间。', '',
  '## 4. 变更与提交', '',
  '产品变化涉及单张页布局、共享闲置控制器、模糊/材质配置、直接子元素原生玻璃接入与实时背景。另有绑定 1.0.3 原始 bundle SHA256 的可复现库补丁：缓存复用、零模糊路径、透明边缘修复；dev/build 时自动应用。应用只调用 init / markChanged / destroy，不访问实例私有字段。',
  '没有修改画廊视图、后端、nginx、.env 或旧 FPS 断言。缓冲优化的历史 RGBA 完全一致证明仅对应当时优化提交；之后 alpha 边缘属于有意改变，不以那份旧对照声称最终全图完全一致。', '',
  '```text', commits.trim(), '```', '',
  '## 5. 事实 / 推断 / 待办 / 决策', '',
  '- 事实：四项修改中描边未完全达标；三种延迟中滚轮和松手静止未达标。自动 UI 脚本通过，不覆盖人工观察到的所有边缘外观，最终人工验收优先。所有失败记录保留。',
  '- 事实：构建成功；正式栈仍运行基线版本；仅本仓库有改动，没有 push。旧 FPS 断言和已失败原始记录与 86aa2c9 一致，此轮没有重跑或放宽。',
  '- 推断：多胶囊输出及收放期间的绘制/读回开销可能贡献了延迟尖峰；现有数据不足以把所有尖峰归因于单一库函数或 GPU 驱动。残留亮缘的全部成因也尚未查明。',
  '- 待办：消除剩余亮缘；解决每个可见胶囊在滚轮与收放期间的实际像素更新时间；修改后重新测量全部三种情况。未验证目标机器外的浏览器/DPR。',
  '- 需要决策：是否继续深入修改库的合成/批量输出路径以保留全部要求；当前候选未达到部署条件。没有自行接受更宽的延迟门槛；旧 FPS 问题继续保留为既有待决事项。', '',
  '## 复现', '',
  '在仓库目录打开两个 PowerShell 窗口。正式栈需保持运行以提供只读 API 与图片。', '',
  '```powershell', 'npm run build', 'node scripts/serve-verification-build.mjs', '```', '',
  '第二个窗口依次执行，禁止与构建或其他浏览器测试并行：', '',
  '```powershell', "$env:VERIFY_URL='http://127.0.0.1:5187'", 'node scripts/verify-capsules.mjs', 'node scripts/verify-glass-latency.mjs', 'node scripts/report-capsules.mjs', '```', '',
  '本次第一条 UI 验收通过，第二条按原 <16ms 断言返回失败。报告工具保留失败结果，不把它变成通过。', '',
  '## 逐次采样（ms，展示到 0.1；未舍入原数值见 latency-candidate-failed.json）', '',
  ...latency.cases.flatMap(c => [`${c.name}，index 0–59：`, '', '```text', c.samples.map(s => s.timedOut ? 'timeout' : f(s.latencyMs)).join(', '), '```', '']),
]
await writeFile(dir + 'REPORT.md', lines.join('\n'))
console.log(JSON.stringify({ status: audit.status, sourceHead: head, candidateModule: latency.servedModule, summaries, screenshots: (await readdir(dir)).filter(n => n.endsWith('.png')).length }))

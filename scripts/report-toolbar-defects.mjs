import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises'
import {browserSession} from './browser-session.mjs'
const folder='docs/verification/2026-10-06-toolbar-defects'
await mkdir(folder,{recursive:true})
const read=async name=>JSON.parse(await readFile(`.superpowers/verification/${name}/report.json`,'utf8'))
const baseline=await read('toolbar-baseline'),area=await read('toolbar-area'),ink=await read('toolbar-ink-final'),dots=await read('toolbar-dots-final')
const page=await read('toolbar-loading-page')
const edge=JSON.parse(await readFile('.superpowers/verification/wheel-ink-diagnosis-micro.json','utf8'))
const wideWheel=JSON.parse(await readFile('.superpowers/verification/wheel-ink-diagnosis.json','utf8'))
assert.equal(ink.status,'passed');assert.equal(dots.status,'passed')
const rasterGaps=dots.raster.flatMap(r=>[r[1].x-r[0].x,r[2].x-r[1].x])
const rasterMirrors=dots.frames.slice(1,120).map((f,index)=>{const i=index+1,z=dots.frames[120-i];const k=f.dots.toSorted((a,b)=>a.x-b.x).findIndex(d=>d.x===f.dots[0].x),j=z.dots.toSorted((a,b)=>a.x-b.x).findIndex(d=>d.x===z.dots[0].x);return Math.abs(dots.raster[i][k].x+dots.raster[120-i][j].x-56)})
assert.ok(Math.max(...rasterMirrors)<.05,'Rendered entry and exit must mirror within subpixel raster tolerance')
const edgeSteps=edge.slice(1).map((s,i)=>({pixels:Math.abs(s.geometry.photo.bottom-edge[i].geometry.photo.bottom),ink:Math.max(...s.ink.map((v,k)=>Math.abs(v-edge[i].ink[k])))}))
assert.ok(edgeSteps.every(s=>s.pixels<.09&&s.ink<=8),'Subpixel wheel movement across the photo boundary must stay continuous')
const b=await browserSession('toolbar-evidence',9305)
try {
 const indices=[0,10,20,30,40,50,60,70,80,90,100,110,120]
 const pictures=await Promise.all(indices.map(async i=>(await readFile(`.superpowers/verification/toolbar-dots-final/frame-${String(i).padStart(3,'0')}.png`)).toString('base64')))
 const backdrop=(await readFile('.superpowers/verification/toolbar-dots-final/backdrop.png')).toString('base64')
 const color=await b.evaluate(`(async()=>{
  const decode=async src=>{const i=new Image();await new Promise(r=>{i.onload=r;i.src='data:image/png;base64,'+src});const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);return ctx.getImageData(0,0,c.width,c.height)};
  const bg=await decode(${JSON.stringify(backdrop)}),frames=${JSON.stringify(indices.map(i=>dots.frames[i]))},positions=${JSON.stringify(indices.map(i=>dots.raster[i]))},pictures=${JSON.stringify(pictures)},out=[];
  for(let i=0;i<pictures.length;i++){const image=await decode(pictures[i]),f=frames[i],sorted=f.dots.toSorted((a,b)=>a.x-b.x),ink=parseFloat(f.computed.match(/[\\d.]+/)[0]);
   for(let k=0;k<3;k++){const x=Math.round((positions[i][k].x+4)*6),y=20*6;const p=(y*image.width+x)*4;const actual=Array.from(image.data.slice(p,p+3)),background=Array.from(bg.data.slice(p,p+3));const predicted=background.map(v=>v+(ink-v)*sorted[k].opacity);out.push({t:f.t,k,ink,opacity:sorted[k].opacity,actual,predicted,error:Math.max(...actual.map((v,c)=>Math.abs(v-predicted[c]))),labelCentre:(f.ink.values[23]+f.ink.values[24])/2,source:f.ink.source});}
  }return out;
 })()`)
 assert.ok(color.every(c=>c.error<2),'Rendered dots must match the computed ink composited at their measured opacity')
 assert.ok(color.every(c=>Math.abs(c.ink-c.labelCentre)<.5),'Dots and labels must use the same computed ink at the centre')
 dots.color=color
 console.log('dot color maximum channel error',Math.max(...color.map(c=>c.error)))
 // Contact sheet uses original captures with no rescaling of their pixels.
 const sheet=await b.evaluate(`(async()=>{const sources=${JSON.stringify(pictures)},times=${JSON.stringify(indices.map(i=>dots.frames[i].t))};const c=document.createElement('canvas');c.width=384*3;c.height=266*5;const ctx=c.getContext('2d');ctx.fillStyle='#f4f4f4';ctx.fillRect(0,0,c.width,c.height);for(let n=0;n<sources.length;n++){const i=new Image();await new Promise(r=>{i.onload=r;i.src='data:image/png;base64,'+sources[n]});const x=n%3*384,y=Math.floor(n/3)*266;ctx.fillStyle='#111';ctx.font='16px sans-serif';ctx.fillText(times[n].toFixed(0)+' ms',x+10,y+20);ctx.drawImage(i,x,y+26)}return c.toDataURL('image/png').split(',')[1]})()`)
 await writeFile(`${folder}/dots-cycle-6x.png`,Buffer.from(sheet,'base64'))
}finally{b.close()}

await writeFile(`${folder}/dots.json`,JSON.stringify(dots,null,2))
await writeFile(`${folder}/ink.json`,JSON.stringify(ink,null,2))
await writeFile(`${folder}/baseline.json`,JSON.stringify(baseline,null,2))
await writeFile(`${folder}/area-oracle.json`,JSON.stringify(area,null,2))
await writeFile(`${folder}/loading-page.json`,JSON.stringify(page,null,2))
await writeFile(`${folder}/wheel-edge.json`,JSON.stringify({before:{deltas:[1,1,1,2,2,2,2,25,0,1,1,0,0,1,1,1,2,2,2,22],max:25,commit:'95658ba'},after:edge,steps:edgeSteps,coarseProbe:wideWheel},null,2))
await copyFile('.superpowers/verification/toolbar-loading-page/page-loading-6x.png',`${folder}/loading-page-6x.png`)
for(const [i,p]of ink.photos.entries())for(const mode of ['on','off'])await copyFile(`.superpowers/verification/toolbar-ink-final/${p.photo}-${mode}-6x.png`,`${folder}/photo-${i+1}-${mode}-6x.png`)
await copyFile('.superpowers/verification/toolbar-dots-final/reduced-motion.png',`${folder}/dots-reduced-6x.png`)
const distribution=arr=>{const a=arr.toSorted((x,y)=>x-y);return[a[Math.floor(a.length*.5)],a[Math.floor(a.length*.9)],a.at(-1)].map(v=>v.toFixed(3)).join(' / ')}
const perStep=series=>series.slice(1).map((s,i)=>Math.max(...s.values.map((v,k)=>Math.abs(v-series[i].values[k]))))
const stats=ink.photos.map((p,i)=>`| ${p.photo} | ${distribution(baseline.photos[i].deltas.map(d=>d.ink))} | ${distribution(perStep(p.series))} |`).join('\n')
const lin=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4,srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055
const at=(s,t)=>{const x=Math.max(0,Math.min(23,t*24-.5)),lo=Math.floor(x);return s[lo]+(s[Math.min(23,lo+1)]-s[lo])*(x-lo)}
const adaptation=ink.photos.map(p=>`| ${p.photo} | `+[.1,.3,.5,.7,.9].map(t=>{const s=p.series[0],j=t*47,l=Math.floor(j),v=s.values[l]+(s.values[Math.min(47,l+1)]-s.values[l])*(j-l);return `${lin(.9*srgb(at(s.sampled,t))+.1).toFixed(3)} → ${v.toFixed(1)}`}).join(' | ')+' |').join('\n')
const halos=ink.photos.map((p,i)=>`| ${p.photo} | ${p.pixels.filter(v=>v.halo&&v.count).map(v=>v.text.split('：')[0]).join('、')} | [开](photo-${i+1}-on-6x.png) / [关](photo-${i+1}-off-6x.png) |`).join('\n')
const p=baseline.photos[2],after=area.photos[2],n=1+p.deltas.findIndex(d=>d.ink===Math.max(...p.deltas.map(d=>d.ink)))
const arr=v=>v.map(x=>+x.toFixed(5))
const arrays=JSON.stringify({offsets:[p.series[n-1].offset,p.series[n].offset],oldBefore:arr(p.series[n-1].old),oldAfter:arr(p.series[n].old),areaBefore:arr(after.series[n-1].diagnostic.sampled),areaAfter:arr(after.series[n].diagnostic.sampled)},null,2)
await writeFile(`${folder}/sample-arrays.json`,arrays)
const dotRows=[0,10,20,30,40,50,60,120].map(i=>{const f=dots.frames[i],s=f.dots.toSorted((a,b)=>a.x-b.x);return`| ${f.t.toFixed(3)} | ${s.map(v=>v.x.toFixed(3)).join(', ')} | ${s.map(v=>v.opacity.toFixed(3)).join(', ')} |`}).join('\n')
const maxOracle=Math.max(...area.photos.flatMap(p=>p.series.map(s=>s.oracleError)))
const coreCount=ink.photos.flatMap(p=>p.pixels).reduce((n,p)=>n+p.count,0)
const text=`# 工具条缺陷验证（2026-10-06）

候选服务：**http://127.0.0.1:5187**。起点为 main \`804e31a\`。只构建本仓库的 dist；未启动或停止候选服务，未操作 Docker / :80 生产栈，未 push。

## A：采样机制、连续性与适应性

在旧候选版的四张实拍照片中，先进入“比例：自由”（中心位置连续四次 wheel deltaY=-120），再以 **0.25px** 平移照片，测 **25 个位置 / 24 步**。读取场景像素、实际 CSS 墨色并保存截图。旧版 936×26 → 24×1 的读法确实不是面积平均：在同一 Chrome 的 936×26 黑色画布上，把一整行逐行变白，**仅第 12、13 行会改变输出，输出 R=128，其余 24 行输出 0**。真正的线性亮度面积平均应在每行都给出 1/26=0.0384615。原始实验见 [ink.json](ink.json) 的 resampler。

另一个独立跳变源是旧墨色选择函数的明暗硬切换。20260815 照片从 ${p.series[n-1].offset}px 移到 ${p.series[n].offset}px，某个墨色点变化 240/255；木纹照片出现 255/255。故只更换采样器仍不能保证连续。

新版按实际文字 Range 的完整高度读取原分辨率条带（这些截图为 **20px 高**，不是旧的固定 26px），先做纵向加权列积分，再按 24 段做横向面积积分；边界像素按覆盖面积计权。与独立逐像素二维积分的最大误差 **${maxOracle.toExponential(3)}**。每段使用连续的明暗响应，场景刷新时立即更新墨色。过渡色达不到对比度下限时由 B 的描边补足；没有在相邻段之间平均已选出的黑白墨色。

每一步取 48 个实际墨色位置中的最大变化，单位为 0–255 的 sRGB 通道值：

| 照片 | 旧版 中位数 / P90 / 最大 | 新版 中位数 / P90 / 最大 |
|---|---:|---:|
${stats}

原始采样数组（含跳变前后全部 24 项）见 [sample-arrays.json](sample-arrays.json)；完整序列见 [baseline.json](baseline.json)、[area-oracle.json](area-oracle.json)、[ink.json](ink.json)。这些数据保留了真实原数组，未只摘选最好的几个点。

补充检查还找到照片**外边界**的源光栅跳变：滚轮 DELTA=0.1 每步实际移动下边缘约 ${edgeSteps[0].pixels.toFixed(4)}px，初版面积平均修复仍在越过半像素时跳 25/255。现已用按物理像素分块、浮点矩形裁剪的方式给照片边缘计算覆盖率，同样 21 个位置的单步最大变化降为 **${Math.max(...edgeSteps.map(s=>s.ink))}/255**，中位数/P90/最大为 **${distribution(edgeSteps.map(s=>s.ink))}**。[原始边界记录](wheel-edge.json)。未改动的独立滚轮探针默认 DELTA=6，实际每步将照片边缘移动约 5px，不能把该数值当成亚像素位移；其原始输出和几何仍保留。

下表在同一自由缩放姿态下列出横向多个位置：**背景线性亮度 → 墨色 sRGB**（0 黑、255 白）。位置是整条工具条的比例；照片名本身不代表该姿态下工具条背后的局部明暗。例如 !IMG 的这段实际落在中间调纹理上。

| 照片 | 10% | 30% | 50% | 70% | 90% |
|---|---:|---:|---:|---:|---:|
${adaptation}

## B：局部触发、独立描边与字芯

逐个文字范围检查每个局部像素与该位置墨色的对比度，低于 **5** 即显示该标签的描边。不会用整标签的均值掩盖硬边上的低对比度。判定覆盖文字范围中的空隙，所以会有保守触发（例如日期的某些背景像素失败，而实际不透明笔画仍达标）。可见实际笔画中测得的所有低于 5 的标签都有可见描边。

描边使用 SVG morphology 生成 0.5px 黑内环和 1px 白外环，并从环中扣掉原字形 alpha。墨色层单独绘制在上方，没有模糊 drop-shadow。四张照片的 6 倍开关对照共检测 **${coreCount} 个不透明字芯像素**，**最大 RGB 通道变化为 0**；测试同时断言开关前后的计算墨色完全一致。字芯掩码用独立红色填充截图识别，背景由隐藏字形并触发 glassrefresh 后重新捕获，避免读到旧纹理。

同一墨色渐变的最后绘制使用可复用、明确量化的 2 倍横向纹理，避免 CSS 渐变重绘时出现 1 级像素差。测试曾在完全没有描边的标签上测到这种差值；没有把断言容差放宽到 1。

例如 20260201 的“光圈”最暗字芯 **[0,0,0] → [0,0,0]**，最亮字芯 **[212,212,212] → [212,212,212]**；同图“快门”的最亮白色字芯 **[255,255,255] → [255,255,255]**。各字芯坐标及逐标签结果在 [ink.json](ink.json) 的 pixels。

| 照片 | 出现描边的可见标签 | 6 倍原始截图 |
|---|---|---|
${halos}

## C：真实加载状态的全周期渲染

先限速再进入照片路由，在真实加载状态中暂停原生 CSS 动画并逐相位取样。周期 **1800ms**，共 **121 帧**，56×32 胶囊。文字轮廓与圆点位置都以 PNG 中的实际像素核验，不以 DOM 数量代替渲染验证。圆点用相同的等长 14px 缓动段和非零、相等的端点斜率，确保三个错开相位的点始终同速。居中通过 transform 完成，避开浏览器对负半像素布局外边距的合成取整。

- 每帧 PNG 均分割出 **3 个独立圆点**；中心距 **${dots.summary.gapMin.toFixed(5)}–${dots.summary.gapMax.toFixed(5)}px**，直径 5px，截图中边缘净空至少 8.5px。
- 从截图轮廓独立求出的中心距为 **${Math.min(...rasterGaps).toFixed(4)}–${Math.max(...rasterGaps).toFixed(4)}px**，入场/出场的光栅质心镜像误差最大 **${Math.max(...rasterMirrors).toFixed(4)}px**。上面的更小误差是布局/动画坐标精度，不能混同于截图测量精度。
- 最小透明度 **0.3**，中间为 **0.9**。两端保留淡点，以满足全周期始终可见三个点；出场与入场的透明度曲线互为镜像。
- 左右镜像位置误差 **${dots.summary.mirrorX.toFixed(8)}px**，透明度误差 **${dots.summary.mirrorOpacity}**。
- 测得速度 **${dots.summary.speedMin.toFixed(2)}–${dots.summary.speedMax.toFixed(2)}px/s**，没有恒速段或槽位间停顿。
- 截图中圆点颜色与“该位置计算墨色 × 当前透明度 + 实拍背景”的最大通道误差 **${Math.max(...dots.color.map(c=>c.error)).toFixed(3)}/255**，与标签中点墨色差小于 0.5/255；不是固定灰色。
- 减少动态效果时仍保留三个静止、等距的圆点，透明度均为 0.8。

| 时刻 ms | 三个中心 x（相对胶囊左边） | 对应透明度 |
|---:|---|---|
${dotRows}

[完整周期 6 倍拼图](dots-cycle-6x.png) · [减少动态效果截图](dots-reduced-6x.png) · [全部位置、透明度、轮廓、颜色数据](dots.json)。

旧版相同周期的中心距为 **9.246–19.135px**，部分相位仅 2 点可见；这次没有复现实际相交，故不把“重叠”写成已证实原因。

加载测试还复现了“缩略图已解码、原生场景仍是空的 300×150”状态：旧路径读出的 24 项全为 0。现在只有完成绘制的原生场景才会被采样；初始化期间直接采集可见照片及页面背景，并计入 CSS 玻璃的白色覆盖层。无照片像素时读取页面背景色。当前慢加载测试实际覆盖了 fallback-photo 路径，其采样已非全黑。

另用 CDP 暂缓图片请求，专门捕获了 naturalWidth=0 的真实空图片状态：[6 倍截图](loading-page-6x.png)、[读数](loading-page.json)。此时采样亮度为 **${page.ink.sampled[0].toFixed(6)}**，圆点计算色为 **${page.dot}**，没有误读成纯黑。

## 运行及边界

每次改动后均运行 \`npm run build\`。最终专项验收为 \`node scripts/verify-toolbar-ink.mjs\` 和 \`node scripts/verify-toolbar-dots.mjs\`，两者通过，浏览器异常数组均为空。\`node scripts/report-toolbar-defects.mjs\` 额外对保存的真实圆点截图作颜色合成核对，并生成本报告。

没有删除或降低现有断言。历史 \`verify-capsules.mjs\` 要求五个独立胶囊，与本任务的单条 dockBar 结构不符，未据此宣称通过。初始新增探针 \`probe-toolbar-defects.mjs\` 中“展开宽度 >900px”的断言也保留：它对元数据较少、自然展开宽度 444.125px 的木纹照片不成立，运行会在收集完该照片后报错。其面积积分数值已保留；最终专项验收另外检查真实 expanded 状态、无 morph 动画及全序列几何不变，四张照片均满足。
`
await writeFile(`${folder}/README.md`,text)
console.log(folder)

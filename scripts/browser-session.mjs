import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function browserSession(name = 'glass', port = 9250) {
  const out = path.resolve('.superpowers/verification', name)
  await mkdir(out, { recursive: true })
  const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  const processHandle = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--enable-unsafe-swiftshader', `--remote-debugging-port=${port}`,
    `--user-data-dir=${path.join(out, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let tab
  for (let i = 0; i < 100; i++) {
    try { tab = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); if (tab) break } catch {}
    await sleep(100)
  }
  if (!tab) { processHandle.kill(); throw Error('Chrome did not start') }
  const ws = new WebSocket(tab.webSocketDebuggerUrl)
  await new Promise(resolve => ws.addEventListener('open', resolve, { once: true }))
  let id = 0
  const pending = new Map(), listeners = new Map(), errors = []
  const createdTargets = []
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }))
  })
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data)
    if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(JSON.stringify(m.error))) : p.resolve(m.result) }
    else { if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); listeners.get(m.method)?.(m.params) }
  })
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails))
    return r.result.value
  }
  const until = async (expression, timeout = 60000) => {
    const end = Date.now() + timeout
    while (Date.now() < end) { if (await evaluate(expression)) return; await sleep(100) }
    throw Error(`Timeout: ${expression}`)
  }
  const navigate = async (url, width = 1440, height = 1000) => {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
    const navigation = await send('Page.navigate', { url })
    await until(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`)
    return navigation
  }
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    await writeFile(path.join(out, name + '.png'), Buffer.from(r.data, 'base64'))
  }
  const traceIdle = async milliseconds => {
    const events = []
    const tree = await send('Page.getFrameTree')
    const frames = new Set()
    const collect = node => { frames.add(node.frame.id); for (const child of node.childFrames || []) collect(child) }
    collect(tree.frameTree)
    for (const target of (await send('Target.getTargets')).targetInfos) if (target.type === 'iframe') frames.add(target.targetId)
    listeners.set('Tracing.dataCollected', params => events.push(...params.value))
    const done = new Promise(resolve => listeners.set('Tracing.tracingComplete', resolve))
    await send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' })
    await sleep(milliseconds)
    await send('Tracing.end'); await done
    const relevant = events.filter(e => frames.has(e.args?.data?.frame))
    return { frames: frames.size, requested: relevant.filter(e => e.name === 'RequestAnimationFrame').length,
      executed: relevant.filter(e => e.name === 'FireAnimationFrame').length,
      requestedAll: events.filter(e => e.name === 'RequestAnimationFrame').length,
      executedAll: events.filter(e => e.name === 'FireAnimationFrame').length }
  }
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable')
  await send('Network.setCacheDisabled', { cacheDisabled: true })
  listeners.set('Target.targetCreated', params => createdTargets.push(params.targetInfo))
  await send('Target.setDiscoverTargets', { discover: true })
  const graphics = await evaluate(`(()=>{const gl=document.createElement('canvas').getContext('webgl');if(!gl)return {available:false};const ext=gl.getExtension('WEBGL_debug_renderer_info');const info={available:true,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};gl.getExtension('WEBGL_lose_context')?.loseContext();return info})()`)
  const version = await send('Browser.getVersion')
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.__metrics={requested:0,executed:0,active:new Set(),cls:0,longTasks:[],draws:0,timers:0};
    const timeout=setTimeout.bind(window);window.setTimeout=(fn,delay,...args)=>{__metrics.timers++;return timeout(fn,delay,...args)};
    const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
    window.requestAnimationFrame=callback=>{__metrics.requested++;let id=raf(t=>{__metrics.active.delete(id);__metrics.executed++;callback(t)});__metrics.active.add(id);return id};
    window.cancelAnimationFrame=id=>{__metrics.active.delete(id);cancel(id)};
    new PerformanceObserver(list=>{for(const e of list.getEntries())if(!e.hadRecentInput)__metrics.cls+=e.value}).observe({type:'layout-shift',buffered:true});
    new PerformanceObserver(list=>{for(const e of list.getEntries())__metrics.longTasks.push({start:e.startTime,duration:e.duration})}).observe({type:'longtask',buffered:true});
    const context=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(type,...args){const c=context.call(this,type,...args);if(c&&type==='webgl'){const draw=c.drawArrays.bind(c);c.drawArrays=(...a)=>{__metrics.draws++;return draw(...a)}}return c};
  ` })
  return { send, evaluate, until, navigate, shot, traceIdle, out, errors, graphics, version, createdTargets, on: (method, fn) => listeners.set(method, fn),
    close: () => { ws.close(); processHandle.kill() } }
}

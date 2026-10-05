import source from '@ybouane/liquidglass?raw'

type RenderedGlass = { blob: Blob; style: string }

// A separate document limits DOM capture to the small bitmap scene. Same-origin
// frames share the visible page's frame clock; hidden cross-origin frames can
// suspend rendering after scrolling. The library remains unmodified.
// Its only API calls are init() and destroy(); communication uses a private port.
export async function createGlassRenderer(signal: AbortSignal) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.dataset.glassRenderer = ''
  frame.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;border:0;z-index:-1;'
  frame.srcdoc = `<!doctype html><html><body style="margin:0"><script>
    addEventListener('message', async function connect(event) {
      if(event.source !== parent || !event.ports[0]) return;
      removeEventListener('message', connect);
      const port=event.ports[0];
      try {
        const url=URL.createObjectURL(new Blob([event.data.source],{type:'text/javascript'}));
        const {LiquidGlass}=await import(url);URL.revokeObjectURL(url);
        port.onmessage=async event=>{
          const {id,bitmap,width,height}=event.data;
          let instance,root;
          try {
            root=document.createElement('div');
            root.style.cssText='position:relative;width:'+width+'px;height:'+height+'px';
            const scene=document.createElement('canvas');scene.width=bitmap.width;scene.height=bitmap.height;
            scene.style.cssText='position:absolute;inset:0;width:'+width+'px;height:'+height+'px';
            scene.getContext('2d').drawImage(bitmap,0,0);bitmap.close();
            const panel=document.createElement('div');
            panel.style.cssText='position:absolute;left:20px;top:20px;width:'+(width-40)+'px;height:'+(height-40)+'px;background:transparent;';
            panel.dataset.config=JSON.stringify({floating:true,cornerRadius:40,blurAmount:0});
            root.append(scene,panel);document.body.append(root);
            instance=await LiquidGlass.init({root,glassElements:[panel]});
            await new Promise(resolve=>requestAnimationFrame(resolve));
            const canvas=panel.querySelector('canvas');
            if(!canvas || !canvas.width || !canvas.height)throw Error('No rendered glass');
            if(!canvas.getContext('2d').getImageData(Math.floor(canvas.width/2),Math.floor(canvas.height/2),1,1).data[3])throw Error('Empty rendered glass');
            const style=canvas.style.cssText;
            const encoded=new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
            // toBlob snapshots the pixels synchronously. Stop the library before
            // waiting for PNG encoding; no extra shader frames during that wait.
            instance.destroy();instance=undefined;root.remove();root=undefined;
            const blob=await encoded;
            if(!blob)throw Error('No glass bitmap');
            port.postMessage({id,blob,style});
          } catch(error) {port.postMessage({id,error:String(error)});}
          finally {instance?.destroy();root?.remove();}
        };
        port.postMessage({ready:true});
      } catch(error) {port.postMessage({error:String(error)});}
    });
  </script></body></html>`
  const channel = new MessageChannel()
  let sequence = 0
  const pending = new Map<number, { resolve: (value: RenderedGlass) => void; reject: (reason: unknown) => void; deadline: number }>()
  const ready = new Promise<void>((resolve, reject) => {
    const deadline = window.setTimeout(() => reject(Error('Glass renderer did not start')), 8000)
    channel.port1.onmessage = event => {
      if (event.data.ready) { clearTimeout(deadline); resolve(); return }
      const task = pending.get(event.data.id)
      if (!task) { if (event.data.error) reject(Error(event.data.error)); return }
      pending.delete(event.data.id)
      clearTimeout(task.deadline)
      // Keep only the parsed module and message port, with no visible frame or
      // live library instance. A later scene does not repeat module startup.
      // destroy() has already stopped all library work and removed the scene.
      // Keep just the parsed module at a 1px viewport for the next snapshot.
      frame.style.width = '1px'
      frame.style.height = '1px'
      if (event.data.error) task.reject(Error(event.data.error))
      else task.resolve(event.data)
    }
    signal.addEventListener('abort', () => { clearTimeout(deadline); reject(new DOMException('Aborted', 'AbortError')) }, { once: true })
  })
  signal.addEventListener('abort', () => {
    frame.remove()
    for (const task of pending.values()) { clearTimeout(task.deadline); task.reject(new DOMException('Aborted', 'AbortError')) }
    pending.clear()
    channel.port1.close()
  }, { once: true })
  frame.addEventListener('load', () => {
    if (!signal.aborted) frame.contentWindow?.postMessage({ source }, '*', [channel.port2])
  }, { once: true })
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
  document.body.append(frame)
  await ready
  return {
    render: async (scene: { draw: () => HTMLCanvasElement; width: number; height: number }) => {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      frame.style.width = `${scene.width}px`
      frame.style.height = `${scene.height}px`
      frame.getBoundingClientRect()
      const bitmap = await createImageBitmap(scene.draw())
      if (signal.aborted) { bitmap.close(); throw new DOMException('Aborted', 'AbortError') }
      const id = ++sequence
      return new Promise<RenderedGlass>((resolve, reject) => {
        const deadline = window.setTimeout(() => { pending.delete(id); reject(Error('Glass render timed out')) }, 8000)
        pending.set(id, { resolve, reject, deadline })
        channel.port1.postMessage({ id, bitmap, width: scene.width, height: scene.height }, [bitmap])
      })
    },
  }
}

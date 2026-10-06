import {readFile} from 'node:fs/promises'
import {browserSession} from './browser-session.mjs'
const b=await browserSession('inspect-core',9303)
try {
const prefix='.superpowers/verification/toolbar-ink-final/IMG_20260815_153938.jpg-'
const shots=Object.fromEntries(await Promise.all(['on','off','mask','backdrop'].map(async k=>[k,(await readFile(prefix+k+'-6x.png')).toString('base64')])))
console.log(await b.evaluate(`(async()=>{
const shots=${JSON.stringify(shots)},images={};let W,H;
for(const [k,v]of Object.entries(shots)){const i=new Image();await new Promise(r=>{i.onload=r;i.src='data:image/png;base64,'+v});const c=document.createElement('canvas');c.width=W=i.width;c.height=H=i.height;const ctx=c.getContext('2d');ctx.drawImage(i,0,0);images[k]=ctx.getImageData(0,0,W,H).data}
const rgb=(k,x,y)=>Array.from(images[k].slice((y*W+x)*4,(y*W+x)*4+3));const isCore=(x,y)=>{const p=(y*W+x)*4;return images.mask[p]===255&&images.mask[p+1]===0&&images.mask[p+2]===0};let n=0,eroded=0,examples=[];
for(let y=2;y<H-2;y++)for(let x=2;x<W-2;x++)if(isCore(x,y)&&rgb('on',x,y).join()!=rgb('off',x,y).join()){n++;let inside=true;for(let yy=y-2;yy<=y+2;yy++)for(let xx=x-2;xx<=x+2;xx++)inside&&=isCore(xx,yy);if(inside)eroded++;if(examples.length<20)examples.push({x,y,on:rgb('on',x,y),off:rgb('off',x,y),bg:rgb('backdrop',x,y),inside})}
return {n,eroded,examples};})()`))
}finally{b.close()}

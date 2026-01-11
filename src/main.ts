import './style.css'
import { CONFIG } from './config'
import { startRouter } from './router'

const app = document.querySelector<HTMLDivElement>('#app')
if (!app) throw new Error('Missing #app container')

document.documentElement.style.setProperty('--frame', CONFIG.previewFrameCss)
document.documentElement.style.setProperty('--stamp-font', CONFIG.stampFontFamilyCss)

startRouter(app)

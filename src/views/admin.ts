import '../admin.css'
import { getAllPhotos, thumbnailUrl, originalUrl } from '../photos'
import type { Photo } from '../photos'
import { clear, el } from '../utils/dom'
import { invalidateGallery } from './gallery'
import { attachGlass } from '../utils/glass'
import { attachIdleToolbar } from '../utils/idleToolbar'

const MAX_UPLOAD_BYTES = Math.floor(14.7 * 1024 * 1024)
const controlLifetimes = new WeakMap<HTMLElement, AbortController>()

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options)
  const body = await response.json()
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`)
  return body as T
}

function json(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

export async function renderAdminView(container: HTMLElement, signal: AbortSignal) {
  const session = await request<{ authenticated: boolean }>('/api/session')
  if (signal.aborted) return
  controlLifetimes.get(container)?.abort()
  const controls = new AbortController()
  controlLifetimes.set(container, controls)
  signal.addEventListener('abort', () => controls.abort(), { once: true, signal: controls.signal })
  clear(container)
  const shell = el('div', { className: 'shell adminShell' })
  const topbar = el('div', { className: 'topbar' })
  const bar = el('div', { className: 'glass topbarInner' })
  const actions = el('div', { className: 'actions' })
  const feedback = el('div', { className: 'adminFeedback' })
  feedback.setAttribute('role', 'status')
  feedback.setAttribute('aria-live', 'polite')
  const content = el('main', { className: 'content' })
  const list = el('div', { className: 'masonry' })
  actions.append(el('a', { className: 'btn', href: '#/' }, ['返回']))
  bar.append(actions)
  topbar.append(bar)
  content.append(feedback, list)
  shell.append(topbar, content)
  container.append(shell)
  // Wrap and measure after all controls exist. Appending the upload form
  // outside the measured wrapper overlapped the return/logout buttons.
  const attachToolbar = () => {
    attachIdleToolbar(bar, controls.signal, 'top')
    void attachGlass(shell, bar, controls.signal)
  }

  const showError = (error: unknown) => {
    feedback.textContent = error instanceof Error ? error.message : '请求失败'
  }

  if (!session.authenticated) {
    const password = el('input', { type: 'password', autocomplete: 'current-password', required: true })
    const login = el('button', { className: 'btn', type: 'submit' }, ['登录'])
    const form = el('form', { className: 'adminLogin' }, [el('label', {}, ['密码', password]), login])
    list.append(form)
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      login.disabled = true
      try {
        await request('/api/login', json('POST', { password: password.value }))
        if (!signal.aborted) await renderAdminView(container, signal)
      } catch (error) { showError(error) }
      finally { login.disabled = false }
    })
    attachToolbar()
    return
  }

  const refresh = async () => {
    const photos = await getAllPhotos()
    if (signal.aborted) return
    list.replaceChildren(...photos.map(card))
  }

  function card(photo: Photo): HTMLElement {
    const media = el('div', { className: 'tileMedia' })
    media.style.aspectRatio = `${photo.width} / ${photo.height}`
    const image = el('img', {
      src: photo.derived.thumb ? thumbnailUrl(photo) : originalUrl(photo),
      alt: photo.id, loading: 'lazy', className: 'isLoaded',
    })
    media.append(image)
    const title = el('input', { value: photo.title })
    const description = el('textarea', { value: photo.description, rows: 3 })
    const save = el('button', { className: 'btn', type: 'submit' }, ['保存'])
    const remove = el('button', { className: 'btn', type: 'button' }, ['删除'])
    const buttons = el('div', { className: 'actions' }, [save, remove])
    const form = el('form', { className: 'adminFields' }, [
      el('label', {}, ['标题', title]), el('label', {}, ['描述', description]), buttons,
    ])
    form.addEventListener('submit', async (event) => {
      event.preventDefault()
      save.disabled = true
      try {
        await request(`/api/photo/${encodeURIComponent(photo.id)}`, json('PATCH', {
          title: title.value, description: description.value,
        }))
        invalidateGallery()
        feedback.textContent = '已保存'
      } catch (error) { showError(error) }
      finally { save.disabled = false }
    })
    const article = el('article', { className: 'tile' }, [
      el('a', { href: `#/photo/${encodeURIComponent(photo.id)}` }, [media]), form,
    ])
    article.dataset.photoId = photo.id
    remove.addEventListener('click', async () => {
      if (!window.confirm(`删除「${photo.title || photo.id}」？`)) return
      remove.disabled = true
      try {
        await request('/api/delete', json('POST', { id: photo.id }))
        invalidateGallery()
        article.remove()
        feedback.textContent = '已删除'
      } catch (error) { showError(error) }
      finally { remove.disabled = false }
    })
    return article
  }

  const file = el('input', { type: 'file', accept: '.jpg,.jpeg,.png,.webp,.avif,.gif', required: true })
  file.setAttribute('aria-label', '照片')
  const upload = el('button', { className: 'btn', type: 'submit' }, ['上传'])
  const uploadForm = el('form', { className: 'actions adminUpload' }, [file, upload])
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    const selected = file.files?.[0]
    if (!selected) return
    if (selected.size > MAX_UPLOAD_BYTES) {
      feedback.textContent = '原图不能超过 14.7 MiB'
      return
    }
    upload.disabled = true
    feedback.textContent = '等待'
    try {
      const form = new FormData()
      form.append('file', selected)
      const result = await request<Photo>('/api/upload', { method: 'POST', body: form })
      invalidateGallery()
      await refresh()
      file.value = ''
      feedback.textContent = result.derived.thumb && result.derived.web ? '已上传' : '已上传，衍生图未全部生成'
    } catch (error) { showError(error) }
    finally { upload.disabled = false }
  })
  const logout = el('button', { className: 'btn', type: 'button' }, ['退出'])
  logout.addEventListener('click', async () => {
    logout.disabled = true
    try {
      await request('/api/logout', { method: 'POST' })
      if (!signal.aborted) await renderAdminView(container, signal)
    } catch (error) { showError(error); logout.disabled = false }
  })
  actions.append(logout)
  bar.append(uploadForm)
  attachToolbar()
  await refresh()
}

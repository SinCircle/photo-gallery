import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { createApp } from '../src/index.js'
import { readIndex, writeIndex } from '../src/photos/store.js'

const PASSWORD = 'correct horse battery staple'
const PASSWORD_HASH = crypto.createHash('sha256').update(PASSWORD).digest('hex')

let photosDir
let cfg
let server
let baseUrl

beforeEach(async () => {
  photosDir = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-routes-'))
  cfg = {
    photosDir,
    originalsDir: path.join(photosDir, 'originals'),
    thumbsDir: path.join(photosDir, 'thumbs'),
    webDir: path.join(photosDir, 'web'),
    indexPath: path.join(photosDir, 'index.json'),
    adminPasswordHash: PASSWORD_HASH,
  }
  server = createApp(cfg).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve))
  await fs.rm(photosDir, { recursive: true, force: true })
})

async function request(route, options = {}) {
  return fetch(`${baseUrl}${route}`, options)
}

async function login() {
  const response = await request('/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  })
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  return { response, cookie }
}

async function imageBuffer(width = 48, height = 32) {
  return sharp({
    create: { width, height, channels: 3, background: { r: 80, g: 110, b: 145 } },
  }).png().toBuffer()
}

function imageForm(bytes, name = 'upload.png', type = 'image/png') {
  const form = new FormData()
  form.append('file', new File([bytes], name, { type }))
  return form
}

describe('会话认证', () => {
  it('正确密码签发 HttpOnly 会话 cookie', async () => {
    const { response, cookie } = await login()
    expect(response.status).toBe(200)
    expect(cookie).toMatch(/^pg_session=.+$/)
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i)
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=Lax/i)
    expect(response.headers.get('set-cookie')).toMatch(/Path=\//i)

    const session = await request('/api/session', { headers: { cookie } })
    expect(await session.json()).toEqual({ authenticated: true })
  })

  it('错误密码返回 401 且不签发会话', async () => {
    const response = await request('/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'wrong password' }),
    })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toMatchObject({ error: expect.any(String) })
  })

  it('退出会撤销 token 并清理 cookie', async () => {
    const { cookie } = await login()
    const response = await request('/api/logout', { method: 'POST', headers: { cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i)

    const session = await request('/api/session', { headers: { cookie } })
    expect(await session.json()).toEqual({ authenticated: false })
  })

  it('写接口在没有有效会话时返回 401', async () => {
    const requests = [
      request('/api/upload', { method: 'POST' }),
      request('/api/delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'photo.jpg' }) }),
      request('/api/photo/photo.jpg', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: '新标题', description: '' }) }),
    ]
    const responses = await Promise.all(requests)
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401])
  })

  it('伪造的 token 不会建立登录态', async () => {
    const response = await request('/api/session', { headers: { cookie: 'pg_session=fake-token' } })
    expect(await response.json()).toEqual({ authenticated: false })
  })
})

describe('照片上传', () => {
  it('登录后保存原图、生成衍生图并写入索引', async () => {
    const { cookie } = await login()
    const response = await request('/api/upload', {
      method: 'POST',
      headers: { cookie },
      body: imageForm(await imageBuffer(), 'sunset.png'),
    })

    expect(response.status).toBe(201)
    const photo = await response.json()
    expect(photo.id).toMatch(/^\d+_sunset\.png$/)
    expect(photo.derived).toEqual({ thumb: true, web: true })
    expect(photo.width).toBe(48)
    expect(photo.height).toBe(32)
    await expect(fs.stat(path.join(cfg.originalsDir, photo.id))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(cfg.thumbsDir, photo.id))).resolves.toBeTruthy()
    await expect(fs.stat(path.join(cfg.webDir, photo.id))).resolves.toBeTruthy()
    const index = await readIndex(cfg.indexPath)
    expect(index.photos.map((entry) => entry.id)).toEqual([photo.id])
  })

  it('文件名路径只保留清洗后的原文件名', async () => {
    const { cookie } = await login()
    const response = await request('/api/upload', {
      method: 'POST',
      headers: { cookie },
      body: imageForm(await imageBuffer(), 'C:\\fakepath\\旅行照.png'),
    })
    expect(response.status).toBe(201)
    expect((await response.json()).id).toMatch(/^\d+_旅行照\.png$/)
  })

  it('同名文件并发上传时分配不同 id', async () => {
    const { cookie } = await login()
    const bytes = await imageBuffer()
    const responses = await Promise.all([
      request('/api/upload', { method: 'POST', headers: { cookie }, body: imageForm(bytes, 'same.png') }),
      request('/api/upload', { method: 'POST', headers: { cookie }, body: imageForm(bytes, 'same.png') }),
    ])
    expect(responses.map((response) => response.status)).toEqual([201, 201])
    const ids = await Promise.all(responses.map(async (response) => (await response.json()).id))
    expect(new Set(ids).size).toBe(2)
    expect((await readIndex(cfg.indexPath)).photos).toHaveLength(2)
  })

  it('缺少文件、扩展名不支持或 MIME 不匹配时拒绝请求', async () => {
    const { cookie } = await login()
    const missing = await request('/api/upload', { method: 'POST', headers: { cookie }, body: new FormData() })
    const extension = await request('/api/upload', {
      method: 'POST', headers: { cookie }, body: imageForm(await imageBuffer(), 'notes.txt', 'text/plain'),
    })
    const mime = await request('/api/upload', {
      method: 'POST', headers: { cookie }, body: imageForm(await imageBuffer(), 'photo.png', 'image/jpeg'),
    })
    expect(missing.status).toBe(400)
    expect(extension.status).toBe(415)
    expect(mime.status).toBe(415)
  })

  it('拒绝声明为图片但实际无法解码的文件', async () => {
    const { cookie } = await login()
    const response = await request('/api/upload', {
      method: 'POST', headers: { cookie }, body: imageForm(Buffer.from('not an image'), 'fake.png'),
    })
    expect(response.status).toBe(400)
    expect((await readIndex(cfg.indexPath)).photos).toEqual([])
  })

  it('拒绝超过 14.7 MiB 的文件', async () => {
    const { cookie } = await login()
    const tooLarge = Buffer.alloc(Math.floor(14.7 * 1024 * 1024) + 1)
    const response = await request('/api/upload', {
      method: 'POST', headers: { cookie }, body: imageForm(tooLarge, 'large.png'),
    })
    expect(response.status).toBe(413)
  })
})

describe('照片删除', () => {
  it('删除索引记录和三个目录中的同名文件', async () => {
    const id = 'remove-me.jpg'
    await writeIndex(cfg.indexPath, { photos: [{ id, width: 10, height: 10 }] })
    for (const dir of [cfg.originalsDir, cfg.thumbsDir, cfg.webDir]) {
      await fs.mkdir(dir, { recursive: true })
      await fs.writeFile(path.join(dir, id), 'photo')
    }
    const { cookie } = await login()
    const response = await request('/api/delete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    expect(response.status).toBe(200)
    expect((await readIndex(cfg.indexPath)).photos).toEqual([])
    for (const dir of [cfg.originalsDir, cfg.thumbsDir, cfg.webDir]) {
      await expect(fs.access(path.join(dir, id))).rejects.toThrow()
    }
  })

  it('磁盘文件已经不存在时仍可完成删除', async () => {
    const { cookie } = await login()
    const response = await request('/api/delete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'already-gone.jpg' }),
    })
    expect(response.status).toBe(200)
  })

  it('拒绝可能越出照片目录的 id', async () => {
    const { cookie } = await login()
    const response = await request('/api/delete', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ id: '../index.json' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('照片元数据编辑', () => {
  it('更新标题与描述并保留照片其它字段', async () => {
    const existing = { id: 'edit-me.jpg', width: 120, height: 80, takenAt: null, title: '', description: '', exif: [], derived: { thumb: true, web: true } }
    await writeIndex(cfg.indexPath, { photos: [existing] })
    const { cookie } = await login()
    const response = await request(`/api/photo/${existing.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '雨后', description: '傍晚的街道' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...existing, title: '雨后', description: '傍晚的街道' })
    expect((await readIndex(cfg.indexPath)).photos[0]).toMatchObject({ title: '雨后', description: '傍晚的街道' })
  })

  it('拒绝非字符串标题或描述', async () => {
    const { cookie } = await login()
    const response = await request('/api/photo/photo.jpg', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: ['不合法'], description: '' }),
    })
    expect(response.status).toBe(400)
  })

  it('目标照片不存在时返回 404', async () => {
    const { cookie } = await login()
    const response = await request('/api/photo/missing.jpg', {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ title: '', description: '' }),
    })
    expect(response.status).toBe(404)
  })
})

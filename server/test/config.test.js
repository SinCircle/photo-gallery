import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

describe('loadConfig', () => {
  it('给定时返回照片根目录与端口', () => {
    const cfg = loadConfig({ PHOTOS_DIR: '/data/photos', PORT: '8080', ADMIN_PASSWORD_HASH: 'x' })
    expect(cfg.photosDir).toBe('/data/photos')
    expect(cfg.port).toBe(8080)
  })

  it('PORT 缺失时默认 3000', () => {
    const cfg = loadConfig({ PHOTOS_DIR: '/data/photos', ADMIN_PASSWORD_HASH: 'x' })
    expect(cfg.port).toBe(3000)
  })

  it('PHOTOS_DIR 缺失时抛错', () => {
    expect(() => loadConfig({ ADMIN_PASSWORD_HASH: 'x' })).toThrow(/PHOTOS_DIR/)
  })

  it('ADMIN_PASSWORD_HASH 缺失时抛错', () => {
    expect(() => loadConfig({ PHOTOS_DIR: '/data/photos' })).toThrow(/ADMIN_PASSWORD_HASH/)
  })

  it('导出衍生图目录路径', () => {
    const cfg = loadConfig({ PHOTOS_DIR: '/data/photos', ADMIN_PASSWORD_HASH: 'x' })
    expect(cfg.originalsDir).toBe('/data/photos/originals')
    expect(cfg.thumbsDir).toBe('/data/photos/thumbs')
    expect(cfg.webDir).toBe('/data/photos/web')
    expect(cfg.indexPath).toBe('/data/photos/index.json')
  })
})

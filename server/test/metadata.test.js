import { describe, it, expect } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extractDimensions, formatExposureTime, buildExifFields } from '../src/photos/metadata.js'
import { makeJpeg } from './fixtures/make-fixture.js'

describe('extractDimensions', () => {
  it('返回图片的宽高', async () => {
    const buf = await makeJpeg(200)
    const dims = await extractDimensions(buf)
    expect(dims.width).toBe(200)
    expect(dims.height).toBe(150)
  })

  it('对损坏的输入抛错', async () => {
    await expect(extractDimensions(Buffer.from('not an image'))).rejects.toThrow()
  })
})

describe('formatExposureTime', () => {
  it('小于一秒显示为分数', () => {
    expect(formatExposureTime(1 / 4600)).toBe('1/4600s')
  })

  it('大于一秒显示秒', () => {
    expect(formatExposureTime(2.5)).toBe('3s')
  })

  it('1.5 秒保留一位小数', () => {
    expect(formatExposureTime(1.5)).toBe('1.5s')
  })

  it('非法值返回 null', () => {
    expect(formatExposureTime(0)).toBeNull()
    expect(formatExposureTime(-1)).toBeNull()
    expect(formatExposureTime(NaN)).toBeNull()
  })
})

describe('buildExifFields', () => {
  it('只输出存在的字段', () => {
    const fields = buildExifFields({
      Make: 'HUAWEI',
      Model: 'Pura 70 Ultra',
      FNumber: 2.1,
      ExposureTime: 1 / 4600,
      FocalLength: 15,
      ISO: 50,
    })
    expect(fields).toEqual([
      { label: '相机', value: 'HUAWEI Pura 70 Ultra' },
      { label: '光圈', value: 'f/2.1' },
      { label: '快门', value: '1/4600s' },
      { label: '焦距', value: '15mm' },
      { label: 'ISO', value: '50' },
    ])
  })

  it('无 EXIF 时返回空数组', () => {
    expect(buildExifFields({})).toEqual([])
    expect(buildExifFields(null)).toEqual([])
  })

  it('镜头单独成项', () => {
    const fields = buildExifFields({ LensModel: 'XF 35mm F1.4' })
    expect(fields).toEqual([{ label: '镜头', value: 'XF 35mm F1.4' }])
  })

  it('焦距取整', () => {
    expect(buildExifFields({ FocalLength: 15.4 })).toEqual([{ label: '焦距', value: '15mm' }])
  })
})

import sharp from 'sharp'

/**
 * 生成一张纯色 JPEG 用于测试。size 为像素边长。
 * 不写入 EXIF——EXIF 相关的行为用「无 EXIF 的文件」和「模拟返回」分别覆盖。
 */
export async function makeJpeg(sidePx = 64) {
  return sharp({
    create: {
      width: sidePx,
      height: Math.round(sidePx * 0.75),
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
    },
  })
    .jpeg()
    .toBuffer()
}

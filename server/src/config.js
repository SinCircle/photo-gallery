// 衍生路径统一使用正斜杠，避免 Windows 的路径分隔符差异。
function joinUrlPath(base, ...segments) {
  return [base.replace(/[\\/]+$/, ''), ...segments].join('/')
}

// 配置集中在这里读取环境变量，其余模块使用返回的配置对象。
export function loadConfig(env = process.env) {
  const photosDir = env.PHOTOS_DIR
  if (!photosDir) throw new Error('缺少必需的环境变量 PHOTOS_DIR')

  const adminPasswordHash = env.ADMIN_PASSWORD_HASH
  if (!adminPasswordHash) throw new Error('缺少必需的环境变量 ADMIN_PASSWORD_HASH')

  const port = env.PORT ? Number.parseInt(env.PORT, 10) : 3000
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT 不是合法端口号：${env.PORT}`)
  }

  return {
    photosDir,
    originalsDir: joinUrlPath(photosDir, 'originals'),
    thumbsDir: joinUrlPath(photosDir, 'thumbs'),
    webDir: joinUrlPath(photosDir, 'web'),
    indexPath: joinUrlPath(photosDir, 'index.json'),
    adminPasswordHash,
    port,
  }
}

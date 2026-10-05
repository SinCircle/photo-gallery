# Photo Gallery

个人摄影展示站。Node + Nginx 后端，照片存放在宿主机目录中。

## 架构

单容器双进程：

- **Nginx**：发送前端静态文件；直接读挂载目录发送照片；把 `/api/` 反向代理给 Node。
- **Node**：只处理 `/api/`——健康检查、照片列表（后续的管理接口）。

照片不进入镜像，加照片不需要重建容器。

## 目录结构

```
photos/                  ← 宿主机目录，挂载进容器
  originals/             ← 原图
  thumbs/                ← 720px 衍生图
  web/                   ← 1920px 衍生图
  index.json             ← 索引（唯一真相来源）
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

| 变量 | 说明 |
|---|---|
| `PHOTOS_HOST_DIR` | 宿主机上照片库的绝对路径 |
| `PORT` | Node 监听端口，默认 3000 |
| `ADMIN_PASSWORD_HASH` | 管理端密码的哈希（第二期使用） |

生成密码哈希：

```bash
node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" '你的密码'
```

## 运行

```bash
docker compose up --build -d
```

访问 `http://<服务器地址>/`。

## 导入既有照片

把图片放进一个目录，然后：

```bash
docker compose exec gallery node /srv/server/scripts/migrate.js /path/to/images
```

幂等——重复运行只补齐缺失的条目。

## 开发

后端：

```bash
cd server && npm install && npm test
PHOTOS_DIR=/tmp/pg-dev ADMIN_PASSWORD_HASH=dev npm run dev
```

前端：

```bash
npm install && npm run dev
```

开发期 `/media/` 直接从 `PHOTOS_DIR` 读图，不需要 Docker。若使用本仓库的
compose `.env`，前端自动使用对应的 `PHOTOS_HOST_DIR`；也可在 PowerShell 中
设置 `$env:PHOTOS_DIR = '照片库的绝对路径'`。后端另开终端，以同一个本机目录
设置 `PHOTOS_DIR`、配置 `ADMIN_PASSWORD_HASH` 后运行 `npm run dev`。
生产图片仍由 Nginx 直接发送。

## 已知限制

- 原图公开可访问，任何人知道文件名即可获取。
- 索引为单个 JSON 文件，写入是整体的；照片量达到数万张前无需更换。

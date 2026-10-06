# gallery.kaiacademy.top

生产站点使用独立的 `photo-gallery` 容器，由现有 Caddy 转发并自动签发 HTTPS 证书。
服务器是 `43.134.66.71`，DNSPod 中需配置 `gallery` 的 A 记录到该地址。

## 发布文件

- `/opt/photo-gallery/releases/<Git SHA>`：构建所需的发布文件、已编译前端。
- `/opt/photo-gallery/.env`：只保存生产管理密码哈希，权限 600，不进 Git。
- `/srv/photo-gallery/photos`：原图、缩略图、网页图及索引，独立于镜像。
- `/opt/photo-gallery/current-release`：当前发布的 Git SHA。

本地运行构建和后端测试，然后只打包 `dist`、`server/package*.json`、
`server/src`、`server/scripts`、`nginx`、`supervisord.conf`、`deploy`。
照片库另行同步，不把照片、环境文件或 SSH 密钥放进发布源码包。

```sh
cd /opt/photo-gallery/releases/<Git SHA>
sudo docker build -f deploy/Dockerfile --build-arg VCS_REF=<Git SHA> -t photo-gallery:<Git SHA> .
sudo env GALLERY_RELEASE=<Git SHA> docker compose -f deploy/compose.production.yml up -d --no-build
curl --fail http://127.0.0.1:8088/api/health
```

首次部署将 `Caddyfile.gallery` 的站点块加入现有 Caddyfile；先备份并验证配置，再热重载。
已有站点配置、证书和 Docker 数据卷保留。后续发布只更新 gallery 容器。

## 回滚与检查

保留上一版本镜像和发布目录，将 `GALLERY_RELEASE` 指向旧 SHA 后再次运行上述 compose 命令。
照片库不参与镜像回滚。首次发布若取消上线，可移除新增的 Caddy 站点块并停止 gallery 容器。

检查首页、`/api/health`、`/api/photos`、原图/缩略图、字体和前端资源，以及匿名管理请求被拒绝。
核对前端资源哈希与本地构建一致，最后在实际域名下检查桌面与手机页面。

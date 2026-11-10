# 内置摄影素材

以下图片按 [Unsplash License](https://unsplash.com/license) 下载并随静态站点分发，未使用 Unsplash+ 素材。2026-10-05 核对许可，允许免费商业/非商业使用。界面标注摄影师并链接来源。

| 文件 | 摄影师 | 来源 | 作品 |
| --- | --- | --- | --- |
| public/wallpapers/alpine-mist.webp | Mary Brennan | https://unsplash.com/photos/uCcCAf6hGQU | Alpine Mist，2024-11-14 |
| public/wallpapers/cloud-peaks.webp | Katie Moum | https://unsplash.com/photos/ZoxA2AUNEww | Snowcapped mountains，2017-07-17 |
| public/wallpapers/winter-light.webp | Pascal Debrunner | https://unsplash.com/photos/8xkImX3so8U | 瑞士冬日森林，2026-01-21 |

2026-11-10 重新导出：以 16:10 居中裁切（原图 2560×3840 / 2560×1707），统一为 1920×1200、WebP q78，三张合计约 792 KiB（原来约 3.6 MiB）。首页用 `object-fit: cover` 显示，竖版原图按视觉中心偏下裁切以保留树线；设置面板的预览图同样指向 WebP，`loading="lazy"`。偏好里只存壁纸 id，因此改扩展名不需要迁移用户数据。

控件图标：lucide-react（ISC）；favicon 为简单雾线几何图形。系统字体，无第三方字体或 favicon 请求。用户 WebDAV 图片许可由用户自行决定，应用不会复制到静态资产中。

# SDL Fast

SDL Fast 是一款面向 Windows 的高速多线程下载器，包含桌面客户端和浏览器嗅探插件。单个文件可切成最多 64 段并行拉取，尽量跑满可用带宽；也适合上百 GB 的大模型权重、安装包和音视频。

开箱即用，提供安装版与免安装便携版思路，无广告、无捆绑。

## 功能

- **64 线程分段加速**：先探测文件大小与分段支持，再把文件切成最多 64 段同时下载。慢段自动重试，中断后从断点继续。
- **HTTP / HTTPS**：通用直链下载，自定义请求头（如 Referer）、HuggingFace Token，便于拉 GGUF、safetensors 等大文件。
- **视频一键嗅探**：Chrome / Edge 插件自动发现页面里的可下载资源，鼠标移到视频上即可发送到客户端。
- **在线平台**：YouTube、B 站、X、TikTok 等页面由客户端调用 yt-dlp 解析，并尽量选择合适清晰度。
- **HLS / DASH**：m3u8 分片并发下载，支持 AES-128 加密流；DASH 与复杂站点走解析器处理。
- **队列与分类**：多任务排队、批量暂停 / 继续 / 删除；按视频、音乐、程序、压缩包、文档、大模型归档。
- **浏览器接管**：点击网页下载链接时，可改为交给 SDL Fast，而不是只用浏览器默认下载。

## 原理

1. **探测与切段**  
   询问服务器文件大小，确认是否支持 `Range`，再按线程数切段。
2. **并行拉取**  
   各线程从不同偏移量下载，写入同一目标文件；失败分段有限次重试。
3. **合并与校验**  
   直链分段按偏移写回完整文件；HLS 分片按序拼接，若本机有 ffmpeg 则封装为常见视频格式。站点视频由 yt-dlp 选择格式并下载。

## 支持平台

- 客户端：Windows 10 / 11（64 位）
- 插件：Chrome、Edge（Manifest V3，加载已解压扩展）
- 常见来源：在线视频、音频、软件、压缩包、文档、大模型文件、HLS/DASH 流

## 目录

```
desktop/          Electron 桌面客户端
extension/        Chrome / Edge 嗅探插件
scripts/          图标等辅助脚本
```

## 下载

安装包与浏览器插件见 [Releases](https://github.com/ByteOpt/SDL-Fast/releases/tag/v1.0.0)。

- `SDL Fast-setup.exe`：Windows 安装包
- `SDL-Fast-extension.zip`：解压后加载其中的 `extension` 目录

## 运行客户端

需要 [Node.js](https://nodejs.org/) 18 或更高版本。

```bat
cd desktop
npm install
npm start
```

首次解析主流视频站点时，会自动下载 `yt-dlp.exe`。若要把分离的音视频轨合成一个文件，请自行安装 [ffmpeg](https://ffmpeg.org/) 并加入 PATH。

打包便携版：

```bat
cd desktop
npm run pack
```

## 安装浏览器插件

1. 先启动桌面客户端（本地接口：`127.0.0.1:18761`）
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`
3. 打开「开发者模式」
4. 选择「加载已解压的扩展程序」，指向本仓库的 `extension` 目录

插件可嗅探当前页资源、接管浏览器下载，并把链接发到正在运行的客户端。

## 设置说明

在客户端「文件 → 设置」中可调整：

- 默认保存目录
- 默认线程数（1–64）
- 同时进行的任务数
- HuggingFace Token（下载需登录的模型文件时使用）
- 插件发来的单个任务是否自动开始

## 许可

MIT

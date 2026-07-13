# NAS Markdown 笔记浏览器

## 1. 项目目标

读取 NAS（群晖/威联通等）上某个指定文件夹内的全部 Markdown 笔记（含子文件夹），在网页上以列表 + 阅读视图的形式展示，方便随时浏览、搜索自己的笔记，而不需要打开笔记软件或登录 NAS 管理后台。

## 2. 核心功能（MVP）

- **扫描笔记目录**：递归遍历配置的根目录，找出所有 `.md` 文件，保留原有的文件夹层级结构。
- **笔记列表**：按文件夹树 / 修改时间 / 文件名展示笔记列表。
- **笔记详情**：点击笔记后，将 Markdown 渲染为 HTML 展示（支持代码高亮、表格、图片等常见语法）。
- **全文搜索**：按标题或正文关键字搜索笔记。
- **图片/附件展示**：笔记中引用的相对路径图片能正常显示。

## 3. 非目标（暂不做）

- 不做笔记的编辑、保存回写 NAS。
- 不做多用户账号体系（默认单用户自用）。
- 不做移动端 App（先做响应式网页，手机浏览器可用即可）。

## 4. 部署方式（已确定）

- 整个服务打包成一个 **Docker 镜像**，直接部署在 **NAS 自带的 Docker（如群晖 Container Manager）** 中。
- 笔记根目录通过 **volume 挂载**方式，把 NAS 上的笔记文件夹挂载到容器内的固定路径（如 `/notes`，只读挂载即可，避免误写）。服务不需要 SMB/WebDAV/NAS API，直接读容器内的本地路径。
- 服务监听容器内某个端口（如 `3000`），通过 Docker **端口映射**暴露到 NAS 的局域网 IP 上，浏览器访问 `http://<NAS_IP>:<映射端口>` 即可使用。

### 访问范围与更新方式（已确定）

- **远程访问**：NAS 本身已支持远程访问（如 QuickConnect / DDNS + 反向代理），服务只需正常暴露端口即可，不必在应用内单独处理内网穿透。但因为会暴露到公网，**建议至少加一层简单的账号密码或 Basic Auth 保护**，避免笔记内容被任意访问；具体是否加、加在应用层还是 NAS 的反向代理层，留到实现阶段确认。
- **实时监听**：使用文件系统监听（`watchdog`）监听 `/notes` 目录下的新增/修改/删除/重命名事件，检测到变化后增量更新内存中的笔记索引，并通过 **WebSocket 或 SSE** 推送到前端，前端自动刷新目录树/搜索结果，无需手动刷新页面。

## 5. 技术方案

- **后端**：Python + **FastAPI**，提供：
  - `GET /api/notes`：返回笔记目录树；
  - `GET /api/notes/{path}`：返回单篇笔记内容（原文或渲染后的 HTML）；
  - `GET /api/search?q=`：全文搜索接口；
  - `WS /ws/updates`：笔记变化时推送更新事件（新增/修改/删除的路径）。
- **Markdown 渲染**：`python-markdown`（或 `markdown2`），扩展支持 GFM 表格（`tables`）、代码高亮（`codehilite` + `pygments`）、目录锚点等。
- **前端**：React + **Ant Design (antd)** 组件库，单页应用：
  - `Layout` + `Sider`：左侧 `Tree` 组件展示笔记目录树；
  - 右侧内容区渲染当前笔记（Markdown 转 HTML 展示）；
  - 顶部 `Input.Search` 做全文搜索；
  - 通过 WebSocket 监听后端推送，收到变化事件后局部刷新目录树 (`Tree`) 数据 / 当前笔记内容。
- **NAS 访问层**：容器内直接读取挂载路径 `/notes` 下的文件系统，无需额外协议适配。
- **实时监听**：`watchdog` 监听 `/notes`，变化后更新内存索引，通过 FastAPI 的 WebSocket 广播给已连接的前端。
- **搜索**：启动时全量读取正文做内存索引（如用 `whoosh` 轻量全文索引，或简单的关键字匹配起步）；文件变化时增量更新索引。
- **访问保护**：FastAPI 加一个简单的账号密码校验中间件（如 HTTP Basic Auth），或依赖 NAS 反向代理层做鉴权，避免公网直接可见笔记内容。
- **Docker 化**（多阶段构建）：
  - 阶段一：基于 `node` 镜像，构建 React + antd 前端（`npm run build` 产出静态文件）；
  - 阶段二：基于 `python:3.x-slim`，安装后端依赖（`fastapi`、`uvicorn`、`watchdog`、`markdown`/`markdown2`），拷贝后端代码，并把阶段一产出的静态文件拷入，由 FastAPI 通过 `StaticFiles` 直接托管，做到单容器、单端口即可访问前后端；
  - `docker-compose.yml`（或群晖 Container Manager 的项目配置）声明：
    - `volumes`: 宿主机笔记目录 → 容器内 `/notes:ro`；
    - `ports`: 宿主机某端口 → 容器内 `uvicorn` 服务端口（如 `8000`）。

## 6. 后续步骤

1. 搭建后端 FastAPI 项目骨架（`app/`）与前端 React + antd 项目骨架（`web/`）。
2. 实现最小可运行版本：扫描 `/notes` → `/api/notes` 目录树 → `Tree` 展示 → 点击渲染单篇笔记。
3. 加入 `watchdog` 文件监听 + WebSocket 实时推送，前端订阅并局部刷新。
4. 加入全文搜索（`Input.Search`）、Basic Auth 鉴权。
5. 编写多阶段 `Dockerfile` / `docker-compose.yml`，在 NAS Docker 上部署验证挂载、端口映射与远程访问。
6. 补充前端样式、图片/附件展示等能力。
# usages

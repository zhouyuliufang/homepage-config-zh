# Homepage 配置管理器（中文版）· homepage-config-zh

一个**全中文**、可部署在极空间（ZSpace）Docker 下的 Homepage 仪表盘可视化配置工具。

## 特性

- **全中文界面**：所有标签、提示、说明均为中文，专有名词（YAML 字段名、API Key、URL）保持原样以确保配置正确。
- **结构化编辑**：
  - 服务配置 `services.yaml`：分组 → 服务（链接/图标/描述/状态监测/Docker 关联）→ 小部件（类型/地址/密钥/自定义参数）。
  - 书签 `bookmarks.yaml`：分组 → 书签（缩写/图标/链接/描述）。
  - 全局设置 `settings.yaml`：标题/描述/主题/配色/语言/页眉样式/状态样式等表单 + 高级对象配置。
  - 小部件 `widgets.yaml`、Docker `docker.yaml` 及其他：通用递归结构编辑器。
- **原始 YAML 编辑**：每个文件均可切换到「原始 YAML」标签页直接编辑文本，保存时校验语法。
- **自动备份**：每次保存前自动生成 `文件名.bak.时间戳` 备份（保留最近 20 份），可随时回滚。
- **密码鉴权**：通过 `ACCESS_PASSWORD` 环境变量启用（局域网部署建议开启）。
- **零构建前端**：前端为原生 HTML/CSS/JS，无需打包；后端为纯 Node `http` + 单一 `yaml` 依赖，构建稳定。

## 目录结构

```
homepage-config-zh/
├── package.json          # 仅依赖 yaml
├── server.js             # 后端：配置读写 / 备份 / 鉴权 / 健康检查
├── public/               # 前端（原生，无需构建）
│   ├── index.html
│   ├── app.js
│   └── style.css
├── Dockerfile            # node:18-alpine + npmmirror 安装依赖
├── docker-compose.yml    # 极空间部署：挂载 Homepage 的 /config
└── README.md
```

## 部署（极空间 Docker）

1. 将本目录上传到 NAS 的 Docker 项目目录（例如 `/path/to/docker/homepage-config-zh/`）。
2. 构建镜像（务必 `--network host` 以规避 bridge 网络 IP 冲突，并使用 npmmirror）：
   ```bash
   cd homepage-config-zh
   docker build --network host -t homepage-config-zh:latest .
   ```
3. 修改 `docker-compose.yml`：
   - 将 volumes 中的宿主机路径改为你 Homepage 的 `config` 目录（默认与 Homepage 容器挂载路径一致）。
   - 将 `ACCESS_PASSWORD` 改为你自己的强密码。
4. 启动：
   ```bash
   docker compose up -d
   ```
5. 浏览器打开 `http://<极空间IP>:3005`，输入密码即可。

## 使用说明

- 左侧选择配置文件，右侧「可视化编辑」与「原始 YAML」两个标签页可随时切换。
- 结构化编辑中删除分组/服务/小部件会立即在界面生效，点击「保存（自动备份）」才写入磁盘。
- 修改后无需重启 Homepage：其会热加载配置（部分设置如 `settings.yaml` 标题/背景可能需要点击页面右下角刷新按钮）。
- 误改可用「历史备份」恢复到任意时间点。

## 许可证

MIT

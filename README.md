# 基于大模型的个性化资源生成与学习多智能体系统

本项目是 2026 软件杯参赛原型，面向“基于大模型的个性化资源生成与学习多智能体系统开发”。系统采用前后端分离结构，支持本地规则演示，也支持接入 OpenAI 兼容的大模型接口进行真实生成。

## 功能亮点

- 动态学习者画像：根据学习目标、基础、偏好和薄弱点生成个性化画像。
- 知识点掌握雷达图：从先修基础、概念理解、方法迁移、实践应用、表达复盘、学习自驱六个维度展示掌握度。
- 多智能体资源生成闭环：展示诊断、规划、生成、评估、修正、反馈的协作流程。
- 个性化资源包：生成学情诊断、补救微讲义、分层练习、答案解析、错因提醒和后续路径。
- 外接大模型：支持 OpenAI 官方接口和 OpenAI 兼容接口。

## 快速启动

需要本机已安装 Node.js。

```bash
npm run dev
```

如果 PowerShell 禁止执行 npm 脚本，可以使用：

```bash
cmd /c npm run dev
```

启动后访问：

- 前端：<http://127.0.0.1:5173>
- 后端健康检查：<http://127.0.0.1:3000/api/health>
- 大模型连通性测试：<http://127.0.0.1:3000/api/llm-test>
- 用户数据存储状态：<http://127.0.0.1:3000/api/storage/status>
- Docker 判题沙箱状态：<http://127.0.0.1:3000/api/judge/status>

## MySQL 用户数据存储

系统支持把已生成方案、每日进度、练习题、测评结果等工作台状态保存到 MySQL。配置后，后端会自动创建 `workspace_states` 表；未配置 MySQL 时会回退到本地 `data/workspace-state.json`，便于开发演示。

`.env` 示例：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=softwarecup
MYSQL_PASSWORD=your-password
MYSQL_DATABASE=softwarecup
WORKSPACE_STATE_KEY=default
```

也可以使用连接串：

```env
MYSQL_URL=mysql://softwarecup:your-password@127.0.0.1:3306/softwarecup
```

生产环境建议使用不同的 `WORKSPACE_STATE_KEY` 区分用户、班级或租户；当前原型默认保存一个工作台状态。

## Docker 在线评测

代码题使用项目内置服务端判题镜像 `softwarecup-python-judge:latest`。后端启动后会自动检查容器运行时并构建判题镜像；用户和客户侧不需要手动构建镜像。

服务端需要具备一种容器运行时，可以是 Linux Docker Engine、远程 Docker Engine，或兼容 Docker CLI 的 Podman。默认配置如下：

```env
CONTAINER_CLI=docker
JUDGE_IMAGE=softwarecup-python-judge:latest
JUDGE_TIMEOUT_MS=10000
JUDGE_AUTO_BOOTSTRAP=true
```

如果判题容器运行在独立 Linux 服务器上，可以配置远程 Docker Engine：

```env
JUDGE_DOCKER_HOST=tcp://judge-server:2375
```

如果服务端使用 Podman：

```env
CONTAINER_CLI=podman
```

判题容器运行时会禁用网络，限制内存、CPU、进程数，并以非 root 用户执行 Python 测试。若服务端容器运行时不可用，前端会显示“服务端判题环境未就绪”，不会把底层 npipe/daemon 错误暴露给学生。

## 外接大模型配置

复制配置模板：

```bash
copy .env.example .env
```

编辑 `.env`，填入真实密钥：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-api-key
OPENAI_TIMEOUT_MS=180000
```

也可以接入兼容 OpenAI Chat Completions 格式的服务，例如将 `OPENAI_BASE_URL` 改成对应厂商的 `/v1` 地址，并把 `OPENAI_MODEL` 改成该服务支持的模型名。

配置完成后重启服务：

```bash
npm run dev
```

在页面右上角点击“测试大模型”。如果连接成功，状态栏会显示模型名和模型返回内容；点击“生成个性化学习资源”时，返回结果中的“大模型优化建议”会来自真实外部模型。

练习题生成也会优先调用大模型，并把每日打卡进度、已完成任务、历史错题、Docker 判题状态传入出题提示词；大模型失败时才回退到本地专业题库。

## 目录结构

```text
backend/   后端 API 服务
frontend/  前端页面
scripts/   一键启动脚本
package.json
```

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
- Docker 判题沙箱状态：<http://127.0.0.1:3000/api/judge/status>

## Docker 在线评测

代码题使用项目内置 Docker 判题镜像 `softwarecup-python-judge:latest`。后端会在第一次评测或访问 `/api/judge/status` 时自动构建镜像。

使用前请先启动 Docker Desktop，并确认命令行可访问 Docker：

```bash
docker version
```

也可以手动预构建判题镜像：

```bash
docker build -t softwarecup-python-judge:latest backend/judge/python
```

判题容器运行时会禁用网络，限制内存、CPU、进程数，并以非 root 用户执行 Python 测试。若 Docker 未启动，前端会显示“Docker 判题不可用”，系统不会把底层 npipe/daemon 错误暴露给学生。

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

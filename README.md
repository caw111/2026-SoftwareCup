# LearnMate AI 学习陪练

面向 2026 软件杯赛题的“基于大模型的个性化资源生成与学习多智能体系统”。项目围绕学习画像、课程生成、资料问答、掌握度评估、路径重规划、学习日历和在线测评构建一套可运行的个性化学习闭环。

系统支持两种运行方式：

- 未配置大模型时，使用本地规则和题库完成演示。
- 配置 OpenAI 兼容接口或讯飞星火大模型后，课程生成、画像访谈、诊断、补救、报告、问答和图谱治理会接入真实 LLM。

## 核心功能

- 对话式学习画像：通过自然语言访谈提取学习主题、背景、时间、偏好和薄弱点，并形成带置信度的六维画像。
- 个性化课程生成：根据画像、目标、周期、学习资料和模型输出生成每日学习路径、任务、资料和练习。
- 课程资料库 RAG：支持上传课程资料、语义检索、全文问答、引用校验和课程绑定。
- 掌握度视图：基于真实概念、任务、测评和先修关系生成可交互图谱，支持布局保存和 LLM 治理增强。
- 诊断与补救：生成课前诊断、评分、错因分析、补救路径和针对性微讲义。
- 路径重规划：当诊断或测评暴露风险时，生成可审核、可应用、可回滚的学习路径修订。
- 自适应测验与代码评测：支持题量、题型、难度配置，代码题可走 Docker/Podman 沙箱判题并自动降级到本地 runner。
- 学习日历：基于真实学习事件统计热力图、徽章、连续天数和每日活动摘要。
- 学习报告与陪练问答：汇总进度、掌握度、错题、笔记、考试和综合应用证据，生成复盘报告；导师问答支持资料引用。
- 多智能体过程展示：展示诊断、规划、资源生成、评估、反馈和治理等协作节点。

## 技术栈

- 前端：原生 HTML、CSS、JavaScript，单页应用。
- 后端：Node.js 原生 HTTP 服务，ES Modules。
- 数据库：MySQL 8，版本化 SQL 迁移。
- LLM：OpenAI Chat Completions 兼容接口，内置讯飞星火 provider 配置。
- RAG：服务端解析课程资料，检索并构建引用白名单。
- 判题：Docker/Podman 沙箱优先，本地多语言 runner 兜底。
- 测试：`node --test`。

## 目录结构

```text
backend/
  server.js                  后端 API 入口
  src/
    services/                业务服务层
    repositories/            MySQL 访问层
    db/                      连接池与事务
    learning.js              课程、资料、报告生成核心逻辑
    adaptive-learning.js     自适应学习与题库
    learning-graph.js        掌握度图谱构建与治理
    learning-activity.js     日历、热力图、徽章和连续天数统计
    rag.js                   资料解析、检索和引用上下文
    judge.js                 在线判题运行时
  test/                      后端单元与集成测试

frontend/
  index.html                 单页应用结构
  app.js                     前端交互与 API 调用
  styles.css                 页面样式
  *.test.js                  前端结构与行为回归测试

database/
  migrations/                MySQL 版本化迁移

scripts/
  dev.js                     同时启动前后端
  migrate.js                 数据库迁移与状态检查
```

## 环境要求

- Node.js 18 或更高版本。
- MySQL 8，可选但推荐。未配置 MySQL 时可进行本地演示。
- Docker、Podman 或远程 Docker Engine，可选，用于代码题沙箱评测。
- OpenAI 兼容大模型接口或讯飞星火 APIPassword，可选，用于真实 LLM 能力。

## 快速启动

安装依赖：

```bash
npm install
```

启动前后端：

```bash
npm run dev
```

PowerShell 如果禁止执行 npm 脚本，可以使用：

```bash
cmd /c npm run dev
```

默认访问地址：

- 前端：<http://127.0.0.1:5173>
- 后端健康检查：<http://127.0.0.1:3000/api/health>
- 大模型连通性测试：<http://127.0.0.1:3000/api/llm-test>
- 存储状态：<http://127.0.0.1:3000/api/storage/status>
- 判题状态：<http://127.0.0.1:3000/api/judge/status>

## 推荐完整开发环境

启动项目自带 MySQL：

```bash
docker compose up -d mysql
```

复制环境变量模板：

```bash
copy .env.example .env.local
```

写入本地数据库配置：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=softwarecup
MYSQL_PASSWORD=softwarecup-dev
MYSQL_DATABASE=softwarecup
MYSQL_CONNECTION_LIMIT=6
```

执行迁移并启动：

```bash
npm run db:migrate
npm run dev
```

后端启动时也会检查迁移状态并补齐尚未执行的迁移。匿名用户通过 HttpOnly Session Cookie 隔离数据；已有浏览器本地工作台会在数据库为空时自动导入一次。

## 大模型配置

在 `.env.local` 或 `.env` 中配置：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini
OPENAI_API_KEY=sk-your-api-key
OPENAI_TIMEOUT_MS=180000
RAG_FULL_CONTEXT_MAX_CHARS=900000
```

赛题推荐优先使用讯飞相关能力时，可直接使用内置 provider：

```env
LLM_PROVIDER=iflytek
IFLYTEK_API_PASSWORD=your-spark-api-password
IFLYTEK_MODEL=4.0Ultra
OPENAI_TIMEOUT_MS=180000
RAG_FULL_CONTEXT_MAX_CHARS=900000
```

讯飞星火 provider 默认使用 OpenAI 兼容地址 `https://spark-api-open.xf-yun.com/v1`，请求路径为 `/chat/completions`。如果学校或团队账号分配了专用网关，也可以用通用变量覆盖：

```env
LLM_PROVIDER=iflytek
LLM_API_KEY=your-api-password
LLM_BASE_URL=https://spark-api-open.xf-yun.com/v1
LLM_MODEL=4.0Ultra
LLM_WIRE_API=chat
LLM_TIMEOUT_MS=180000
```

也可以使用其他兼容 OpenAI Chat Completions 的第三方模型服务，只要把 `OPENAI_BASE_URL` 和 `OPENAI_MODEL`，或通用的 `LLM_BASE_URL`、`LLM_MODEL` 换成对应服务的配置即可。

配置完成后重启服务，并在页面右上角点击“测试大模型”。连接成功后，画像访谈、课程生成、诊断补救、路径重规划、学习报告、资料问答和掌握度治理会优先使用真实 LLM；失败时会给出可见降级状态。

## 数据库与迁移

项目使用 MySQL 8 保存用户会话、学习方案、任务进度、测评题、答题记录、资料库、路径修订、掌握度图谱、学习活动等核心状态。结构稳定的数据使用关系表；LLM 生成的课程、题目、图谱等复杂载荷使用 JSON 快照保存。

常用命令：

```bash
npm run db:migrate
npm run db:status
```

迁移文件位于 `database/migrations/`。已经执行过的迁移文件不要修改；表结构变化应新增更高编号的 SQL 文件。`schema_migrations` 会记录迁移文件名和 SHA-256 校验值。

## 在线判题

代码题优先使用服务端沙箱运行。默认配置：

```env
CONTAINER_CLI=docker
JUDGE_IMAGE=softwarecup-code-judge:latest
JUDGE_TIMEOUT_MS=10000
JUDGE_AUTO_BOOTSTRAP=true
```

如果使用远程 Docker Engine：

```env
JUDGE_DOCKER_HOST=tcp://judge-server:2375
```

如果使用 Podman：

```env
CONTAINER_CLI=podman
```

后端会自动检查容器运行时并构建判题镜像。沙箱不可用时会降级到服务端本地 runner，确保学生仍然能提交代码并得到评分。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 同时启动后端和前端 |
| `npm run backend` | 只启动后端 API |
| `npm run frontend` | 只启动前端静态服务 |
| `npm run db:migrate` | 执行 MySQL 迁移 |
| `npm run db:status` | 查看迁移状态 |
| `npm test` | 运行全部自动化测试 |

## API 概览

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 后端、数据库、模型配置健康检查 |
| `GET /api/llm-test` | 大模型连通性测试 |
| `GET /api/workspace` | 当前用户工作区 |
| `POST /api/plans` | 创建学习方案 |
| `PUT /api/plans/:planId/tasks/:taskKey` | 更新每日任务进度 |
| `PUT /api/plans/:planId/notes` | 保存学习笔记 |
| `POST /api/quiz` | 生成测验 |
| `POST /api/quiz-questions/:id/attempts` | 提交题目作答 |
| `POST /api/tutor` | 学习陪练问答 |
| `POST /api/sources` | 上传课程资料 |
| `POST /api/sources/search` | 检索课程资料 |
| `POST /api/sources/ask` | 基于资料全文问答 |
| `GET /api/plans/:planId/knowledge-graph` | 获取掌握度图谱 |
| `PATCH /api/plans/:planId/knowledge-graph` | 保存图谱布局 |
| `POST /api/plans/:planId/knowledge-graph/refine` | 使用 LLM 治理图谱 |
| `GET /api/activity/summary` | 学习日历、热力图、徽章和连续天数摘要 |
| `POST /api/learning-report` | 生成学习报告 |
| `GET /api/judge/status` | 判题运行时状态 |

## 测试

运行：

```bash
npm test
```

当前测试覆盖：

- 数据库迁移、校验和与迁移拆分。
- MySQL 持久化、用户隔离、课程、任务、测评和资料库。
- LLM 参数、流式响应、失败降级和诊断补救归一化。
- 对话式画像、画像 LLM、课程资料 RAG 和引用校验。
- 路径重规划、掌握度图谱、学习日历、热力图、徽章和连续天数。
- 前端导航、笔记、课程资料库、画像入口和掌握度/学习日历结构。
- 代码判题错误处理和浏览器安全字段过滤。

## 故障排查

- 页面提示“后端未连接”：确认 `npm run dev` 正在运行，且后端端口为 `3000`。
- MySQL 连接失败：先执行 `docker compose up -d mysql`，再检查 `.env.local` 中的账号、密码和数据库名。
- 迁移失败：不要修改已经执行过的迁移文件；新增迁移时使用新的编号。
- 大模型不可用：检查 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`，或讯飞配置 `LLM_PROVIDER=iflytek`、`IFLYTEK_API_PASSWORD`、`IFLYTEK_MODEL`，并访问 `/api/llm-test`。
- Windows 刷新时出现黑色控制台窗口：后端已对 PowerShell 兜底请求设置隐藏窗口；重启 `npm run dev` 后生效。
- 判题不可用：访问 `/api/judge/status` 查看 Docker/Podman 状态；不可用时系统会自动降级到本地 runner。

## 当前规模

按主要源码统计，项目约 74 个源码文件、2.1 万行代码，主要由 Node.js 后端、原生前端、SQL 迁移和少量 Python 工具组成。

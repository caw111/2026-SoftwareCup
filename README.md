# 基于大模型的个性化资源生成与学习多智能体系统

本项目是 2026 软件杯参赛原型，面向“基于大模型的个性化资源生成与学习多智能体系统开发”。系统采用前后端分离结构，支持本地规则演示，也支持接入 OpenAI 兼容的大模型接口进行真实生成。

## 功能亮点

- 动态学习者画像：根据学习目标、基础、偏好和薄弱点生成个性化画像。
- 知识点掌握雷达图：从先修基础、概念理解、方法迁移、实践应用、表达复盘、学习自驱六个维度展示掌握度。
- 多智能体资源生成闭环：展示诊断、规划、生成、评估、修正、反馈的协作流程。
- 个性化资源包：生成学情诊断、补救微讲义、分层练习、答案解析、错因提醒和后续路径。
- 外接大模型：支持 OpenAI 官方接口和 OpenAI 兼容接口。

## 快速启动

需要本机已安装 Node.js。首次运行先安装依赖：

```bash
npm install
```

如果只需要本地规则演示，可以直接启动：

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
- 判题运行时状态：<http://127.0.0.1:3000/api/judge/status>

## MySQL 用户数据存储

系统使用 MySQL 8 保存用户、学习方案、每日任务、练习轮次和测评结果。核心业务数据采用关系表，结构可能变化的大模型生成结果使用 JSON 快照。数据库结构由 `database/migrations/` 中的版本化 SQL 管理，不在业务代码中动态建表。

本地开发可以先启动项目自带的 MySQL：

```bash
docker compose up -d mysql
```

在不会提交到 Git 的 `.env.local` 中配置：

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=softwarecup
MYSQL_PASSWORD=softwarecup-dev
MYSQL_DATABASE=softwarecup
MYSQL_CONNECTION_LIMIT=6
```

也可以只配置连接串：

```env
MYSQL_URL=mysql://softwarecup:softwarecup-dev@127.0.0.1:3306/softwarecup
```

执行迁移并启动：

```bash
npm run db:migrate
npm run dev
```

后端启动时也会检查并补齐尚未执行的迁移。浏览器通过匿名 HttpOnly 会话隔离用户数据；已有浏览器本地工作台会在该用户数据库为空时自动导入一次。未配置 MySQL 时仍可进行本地演示，但不会声称数据已写入数据库。

应用程序不要直接使用 MySQL `root` 账号。推荐单独创建只拥有 `softwarecup` 数据库权限的业务账号，并把真实密码写入已被 Git 忽略的 `.env.local`。

可以随时检查迁移状态：

```bash
npm run db:status
```

迁移命令是幂等的，已经成功执行的迁移不会重复执行。不要修改已经执行过的迁移文件；表结构变化应新增更高编号的 SQL 文件。

## 测试与验收

配置 MySQL 后执行：

```bash
npm run db:migrate
npm test
```

自动化测试覆盖：

- 数据库迁移结构和迁移文件校验。
- 方案创建、读取及用户数据隔离。
- 每日任务进度和学习笔记持久化。
- 测评题保存、答案提交、评分结果和历史记录。
- 标准答案、关键词及隐藏测试用例不会发送给浏览器。

完整回归还应检查：

```text
GET  /api/health          后端、MySQL 和模型配置
GET  /api/llm-test        外部大模型连通性
GET  /api/storage/status  MySQL 存储状态
GET  /api/judge/status    Docker 或 local-runner 判题状态
```

本项目已验证以下完整链路：前端资源加载、同步/流式方案生成、方案落库、任务打卡、笔记保存、动态出题、普通题和代码题提交、评分结果回读、学习陪练以及方案删除。测试使用的临时用户和数据会在测试结束后清理。

## Docker 在线评测

代码题使用项目内置服务端多语言判题镜像 `softwarecup-code-judge:latest`。后端启动后会自动检查容器运行时并构建判题镜像；用户和客户侧不需要手动构建镜像。

服务端需要具备一种容器运行时，可以是 Linux Docker Engine、远程 Docker Engine，或兼容 Docker CLI 的 Podman。默认配置如下：

```env
CONTAINER_CLI=docker
JUDGE_IMAGE=softwarecup-code-judge:latest
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

判题容器运行时会禁用网络，限制内存、CPU、进程数，并以非 root 用户执行 Python、C++、Java、JavaScript 测试。出题智能体会根据学习主题选择编程语言，例如 C++ 数据结构、Java 后端、JavaScript 前端算法、Python 机器学习。若服务端容器运行时不可用，系统会自动切换到服务端本地多语言 runner，保证用户仍然可以提交代码并获得评分；不会把底层 npipe/daemon 错误暴露给学生。

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
backend/   后端 API、Service、Repository 和数据库连接层
database/  MySQL 版本化迁移与数据库说明
frontend/  前端页面
scripts/   启动和数据库迁移脚本
docker-compose.yml
package.json
```

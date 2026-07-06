# 基于大模型的个性化资源生成与学习多智能体系统

本项目是一个前后端分离的可运行软件原型，用于演示“基于大模型的个性化资源生成与学习多智能体系统开发”。

## 功能概览

- 学情分析智能体：根据学习者目标、基础、偏好和薄弱点生成学习画像。
- 路径规划智能体：拆解阶段目标，生成个性化学习路径。
- 资源生成智能体：生成讲解、案例、练习、拓展资源。
- 测评反馈智能体：生成检测题、学习建议和后续改进方向。
- 前端中文工作台：填写学习需求，一键生成个性化学习方案。

## 目录结构

```text
backend/   后端 API 服务
frontend/  前端页面
package.json  统一启动脚本
```

## 快速启动

需要本机已安装 Node.js。

```bash
npm run dev
```

如果 PowerShell 禁止执行 npm 脚本，可使用：

```bash
cmd /c npm run dev
```

启动后访问：

- 前端：http://localhost:5173
- 后端健康检查：http://localhost:3000/api/health

## 可选大模型配置

默认情况下，后端使用本地规则生成演示结果，保证离线也能运行。若要接入 OpenAI 兼容接口，可设置环境变量：

```bash
set OPENAI_API_KEY=你的密钥
set OPENAI_BASE_URL=https://api.openai.com/v1
set OPENAI_MODEL=gpt-4.1-mini
```

然后重新运行 `npm run dev`。

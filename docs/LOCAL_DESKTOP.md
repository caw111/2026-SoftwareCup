# 单机桌面版架构

## SQLite 数据

未配置 MySQL 时，后端自动使用 Node.js 内置 SQLite。便携版数据库位于：

```text
%LOCALAPPDATA%\PersonalizedLearning\data\learning.sqlite3
```

学习方案、每日任务、测评题目、作答记录、掌握证据、设置、辅导历史和项目状态均写入 SQLite。浏览器 `localStorage` 只保留为兼容旧数据和数据库暂时不可用时的兜底。

便携版固定使用 `local-desktop-user`，不依赖浏览器 Cookie 的过期时间。第一次运行新版时，旧 `localStorage` 中的方案会通过现有导入接口迁移到 SQLite。

## 内置 Python

构建脚本下载 Python 3.13.14 Windows 64 位嵌入式发行包，校验 SHA-256 后放入：

```text
runtime\python\python.exe
```

学生 Python 代码不在 Node.js 主进程运行。后端以 `-I -S -B` 启动独立 Python 子进程，通过标准输入传入代码和测试用例，并应用：

- 10 秒外部总超时；
- Windows Job Object 或 Unix `rlimit` 的 CPU、内存、文件和进程限制；
- 256 MB 进程内存限制；
- 单进程限制；
- 16 KB 标准输出限制；
- 禁止文件、网络、子进程和系统命令；
- 只允许算法题常用标准库模块。

该执行器支持完整 Python 语法、循环、递归、类和常用标准库，但有意禁止第三方包及操作系统能力。

## 安全边界

本地受限执行器适合本人演示、可信课堂代码和离线比赛原型。它不是面向公网恶意用户的强安全边界，也不与 Docker/虚拟机完全等价。

如果未来允许陌生用户提交任意代码，应将判题迁移至独立低权限账户下的 Windows AppContainer/Hyper-V 沙箱，或远程 Linux 容器服务，并让主应用只通过受限 RPC 提交任务。

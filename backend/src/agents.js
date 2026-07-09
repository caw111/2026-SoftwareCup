export const agents = [
  {
    id: "profile-agent",
    name: "学习画像智能体",
    role: "整合用户目标、基础、偏好、每日完成记录和测评表现，维护可更新的学习画像。"
  },
  {
    id: "diagnosis-agent",
    name: "知识诊断智能体",
    role: "把薄弱点、打卡进度、错题原因映射到知识维度，输出下一轮补救优先级。"
  },
  {
    id: "planner-agent",
    name: "路径规划智能体",
    role: "根据画像和诊断结果拆解阶段目标，生成每日任务和复习节奏。"
  },
  {
    id: "resource-agent",
    name: "资源生成智能体",
    role: "生成讲义、例题、练习题、解析和项目化任务，并接收规划智能体的约束。"
  },
  {
    id: "assessment-agent",
    name: "测评评分智能体",
    role: "根据用户答案自动评分，选择题即时判分，代码题可调用 Docker 沙箱运行测试。"
  },
  {
    id: "coach-agent",
    name: "学习陪练智能体",
    role: "基于当前方案、进度和测评结果回答追问，给出下一步建议。"
  }
];

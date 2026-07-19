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
    id: "knowledge-graph-agent",
    name: "知识图谱智能体",
    role: "把学习主题拆成知识点、先修关系、难度和资源绑定，支撑诊断、推荐与复测。"
  },
  {
    id: "diagnostic-pretest-agent",
    name: "诊断前测智能体",
    role: "根据知识图谱和薄弱维度生成前测题，记录概念掌握证据和错因标签。"
  },
  {
    id: "planner-agent",
    name: "路径规划智能体",
    role: "根据画像和诊断结果拆解阶段目标，生成每日任务和复习节奏。"
  },
  {
    id: "daily-agent",
    name: "每日任务智能体",
    role: "把阶段路径拆成可打卡、可复测、可调整的每日任务，并绑定知识点、材料和预计用时。"
  },
  {
    id: "resource-agent",
    name: "资源生成智能体",
    role: "生成讲义、例题、练习题、解析和项目化任务，并接收规划智能体的约束。"
  },
  {
    id: "resource-studio-agent",
    name: "资源装配智能体",
    role: "装配思维导图、在线拓展阅读、项目任务包和资源覆盖矩阵，保证至少五类资源可展示可导出。"
  },
  {
    id: "assessment-agent",
    name: "测评评分智能体",
    role: "根据用户答案自动评分，选择题即时判分，代码题可调用 Docker 沙箱运行测试。"
  },
  {
    id: "governance-agent",
    name: "内容治理智能体",
    role: "检查生成资源的知识点绑定、答案一致性、难度匹配、泄题风险和安全边界。"
  },
  {
    id: "quality-agent",
    name: "协作质检智能体",
    role: "检查多智能体产物之间的数据依赖、同行复核结果、资源覆盖和发布门禁。"
  },
  {
    id: "package-agent",
    name: "方案装配智能体",
    role: "把画像、路径、资源、测评、治理、项目任务和陪练上下文装配为可保存的课程方案。"
  },
  {
    id: "insight-agent",
    name: "个人洞察智能体",
    role: "汇总学习风险、薄弱知识点、错题趋势、复测建议和个人学习报告，服务自我调节。"
  },
  {
    id: "coach-agent",
    name: "学习陪练智能体",
    role: "基于当前方案、进度和测评结果回答追问，给出下一步建议。"
  }
];

import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeModelDiagnosticPretest,
  normalizeModelRemediationPlan
} from "../src/learning.js";

test("LLM 课前测输出会归一化为现有诊断字段", () => {
  const diagnostic = normalizeModelDiagnosticPretest({
    diagnosticPretest: {
      title: "生成式 AI 应用开发课前测",
      objective: "定位 API 调用、上下文设计和评估薄弱点",
      scoring: "每题 20 分，记录错因标签",
      expectedMinutes: 12,
      items: [{
        id: "ctx-window-1",
        type: "choice",
        conceptId: "ctx-window",
        conceptTitle: "上下文窗口管理",
        dimension: "实践应用",
        difficulty: 3,
        discrimination: 0.81,
        question: "在构建客服助手时，历史消息过长最应该先做什么？",
        options: [
          "压缩与当前问题相关的历史，并保留关键事实",
          "直接删除所有历史",
          "把系统提示放到最后",
          "让模型自己猜用户背景"
        ],
        answerIndex: 0,
        explanation: "上下文窗口有限，应该保留与当前问题相关的事实和约束，避免无差别删除。",
        misconceptionTags: ["上下文无筛选堆叠"],
        standard: "能根据任务目标筛选和压缩上下文。",
        score: 20
      }, {
        id: "tool-call-1",
        conceptId: "tool-call",
        conceptTitle: "工具调用边界",
        dimension: "方法迁移",
        question: "什么时候更应该调用外部检索工具？",
        options: ["问题依赖最新或私有资料", "问题是简单加法", "用户只是打招呼", "模型已经明确知道事实"],
        answerIndex: 0,
        explanation: "最新或私有资料不能依赖模型记忆，需要外部工具补充证据。",
        misconceptionTags: ["把模型记忆当数据库"]
      }, {
        id: "eval-1",
        conceptId: "eval",
        conceptTitle: "回答质量评估",
        dimension: "表达复盘",
        question: "评估问答助手时，哪项证据最可靠？",
        options: ["基于真实样例的通过率和失败案例分析", "只看模型名称", "只看一次主观感觉", "只看回答长度"],
        answerIndex: 0,
        explanation: "真实样例和失败案例能揭示稳定性和边界。",
        misconceptionTags: ["只看表面指标"]
      }, {
        id: "prompt-1",
        conceptId: "prompt",
        conceptTitle: "提示词约束",
        dimension: "概念理解",
        question: "系统提示最应该明确什么？",
        options: ["角色、边界、输出格式和禁止事项", "只写越聪明越好", "只写回答快一点", "只写不要报错"],
        answerIndex: 0,
        explanation: "系统提示需要给模型稳定的行为边界和输出约束。",
        misconceptionTags: ["提示缺少边界"]
      }]
    }
  }, {}, { topic: "生成式 AI 应用开发" });

  assert.equal(diagnostic.source, "llm");
  assert.equal(diagnostic.items.length, 4);
  assert.equal(diagnostic.items[0].source, "llm-diagnostic");
  assert.match(diagnostic.items[0].question, /客服助手/);
  assert.equal(diagnostic.items.every((item) => item.options.length === 4), true);
});

test("LLM 补救方案输出会归一化为现有补救字段", () => {
  const remediation = normalizeModelRemediationPlan({
    remediationPlan: {
      target: "上下文窗口管理",
      reason: "诊断显示学习者会无筛选堆叠历史，导致回答漂移。",
      weakConcepts: [{
        conceptId: "ctx-window",
        title: "上下文窗口管理",
        dimension: "实践应用",
        masteryScore: 52,
        confidence: 0.58,
        reason: "课前测错在历史压缩策略",
        misconceptions: ["把所有历史都塞进 prompt"]
      }],
      microLessons: [{
        conceptId: "ctx-window",
        title: "上下文窗口不是聊天记录仓库",
        content: "上下文窗口应服务于当前任务。先抽取用户目标、硬约束、最近决策和未解决问题，再删除寒暄、重复解释和已经失效的假设。",
        misconceptionFix: ["不要按时间全量堆叠历史", "先保留能改变答案的事实"]
      }],
      workedExamples: [{
        title: "半成品例题：压缩客服历史",
        prompt: "给定 12 轮客服对话，补全需要保留的 5 条事实。",
        scaffold: ["标出当前问题", "找硬约束", "删除重复寒暄", "写成短事实"]
      }],
      variantItems: [{
        id: "ctx-variant-1",
        type: "short",
        title: "换场景压缩",
        prompt: "把项目会议纪要压缩成下一次模型调用需要的上下文。",
        expected: "应保留目标、决策、待办、风险和输出格式。"
      }],
      retestItems: [{
        id: "ctx-retest-1",
        type: "choice",
        prompt: "哪条信息最应该保留进下一轮上下文？",
        options: ["用户刚确认的预算上限", "三天前的寒暄", "重复的欢迎语", "已经取消的方案"],
        answerIndex: 0,
        expectedScore: 80
      }, {
        id: "ctx-retest-2",
        type: "choice",
        prompt: "上下文压缩后最需要检查什么？",
        options: ["是否丢失会改变答案的约束", "字数是否越少越好", "是否删除所有数字", "是否只保留最后一句"],
        answerIndex: 0,
        expectedScore: 80
      }],
      hintLadder: ["先找目标", "再找约束", "最后删重复"],
      sequence: [
        { step: "证据定位", action: "标出诊断错题中误用上下文的句子。", expectedEvidence: "能指出导致错误的多余或缺失信息。" },
        { step: "微讲义学习", action: "阅读上下文窗口短讲义并写出三类必须保留的信息。", expectedEvidence: "写出目标、约束、待解决问题。" },
        { step: "半成品例题", action: "补全客服历史压缩清单。", expectedEvidence: "保留 5 条事实且无无关寒暄。" },
        { step: "复测", action: "完成两道上下文压缩复测题。", expectedEvidence: "复测达到 80 分。" }
      ],
      coachPrompts: ["请追问我如何压缩上下文，不要直接给答案。"]
    }
  }, {}, { topic: "生成式 AI 应用开发" });

  assert.equal(remediation.source, "llm");
  assert.equal(remediation.sequence.length, 4);
  assert.match(remediation.microLessons[0].content, /上下文窗口应服务于当前任务/);
  assert.equal(remediation.retestItems.length, 2);
});

test("无效 LLM 课前测和补救方案不会被接受", () => {
  assert.throws(() => normalizeModelDiagnosticPretest({
    diagnosticPretest: {
      items: [{
        question: "题目不完整",
        options: ["A", "B"],
        answerIndex: 4
      }]
    }
  }), /课前测题目不足/);

  assert.throws(() => normalizeModelRemediationPlan({
    remediationPlan: {
      microLessons: [],
      variantItems: [],
      retestItems: [],
      sequence: []
    }
  }), /补救方案缺少/);
});

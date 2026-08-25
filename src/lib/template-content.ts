import { mdToDelta } from "./md-parser";
import type { DeltaOps } from "../types/models";

/**
 * 内置模板正文独立成按需加载的模块，避免模板文案和 Markdown 解析器
 * 进入应用首屏资源。
 */
const BUILTIN_TEMPLATE_MARKDOWN: Record<string, string> = {
  "builtin-idea": `## 核心想法

用一句话描述这个想法。

## 背景与价值

- 它解决什么问题？
- 为什么现在值得记录？

## 下一步

- 验证一个最小假设
- 记录需要补充的信息`,
  "builtin-todo": `## 今日重点

- 最重要的一件事

## 待处理

- 添加待办事项
- 添加待办事项

## 已完成

- 将完成项移到这里`,
  "builtin-reading": `## 书目信息

- 书名：
- 作者：
- 阅读日期：

## 核心观点

用自己的话概括作者最重要的观点。

## 摘录与思考

> 记录关键原文或页码。

写下你的理解、质疑或关联。

## 行动与延伸

- 可以实践的行动
- 需要继续阅读的问题`,
  "builtin-knowledge": `## 定义

用一句话准确说明这个概念。

## 原理

解释它如何工作，以及成立的条件。

## 示例

给出一个最小、具体的例子。

## 边界与反例

- 适用范围
- 常见误解
- 不适用的情况

## 关联

- 相关概念或文档`,
  "builtin-meeting": `## 会议信息

- 时间：
- 参与者：
- 目标：

## 议题与结论

### 议题 1

- 讨论要点：
- 结论：

## 决策

- 决策内容与原因

## 行动项

- 负责人 — 事项 — 截止时间

## 待确认

- 尚未解决的问题`,
  "builtin-project": `## 本次目标

说明本次工作的目标和完成标准。

## 进展

- 已完成：
- 正在进行：
- 下一步：

## 关键变更

记录设计、实现或范围上的重要变化。

## 问题与决策

- 问题：
- 决策：
- 原因：

## 风险与阻塞

- 当前风险或依赖`,
  "builtin-weekly": `## 本周摘要

用几句话概括本周结果。

## 已完成

- 重要成果

## 进行中

- 当前进展与预计完成时间

## 数据与反馈

- 关键指标、用户反馈或验证结果

## 风险与阻塞

- 风险、影响和需要的协助

## 下周计划

- 下一周最重要的工作`,
};

export function buildBuiltinTemplateContent(templateId: string): DeltaOps {
  const markdown = BUILTIN_TEMPLATE_MARKDOWN[templateId];
  return markdown ? mdToDelta(markdown) : { ops: [] };
}

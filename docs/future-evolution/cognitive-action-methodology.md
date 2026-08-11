# 认知与行动方法论

> 状态：体系版本 v0.3；最小验证协议仍为 v0.1；尚未完成行为与结果验证
> 文档职责：方法论导航与当前决策结论
> 产品实现：[Nine Rings 产品化与未来演进](nine-rings-productization.md) · [总入口](../future-evolution.md)

本文讨论的不是怎样使用某个 PKM，而是一个独立问题：

> 对重要、可行动、存在不确定性并能够获得反馈的事项，保存事前判断，连接 Decision、Action 与实际 Outcome，区分原始 Feedback 与事后解释，并明确确认 Revision，是否能让认知变化更容易被发现、检验和复用？

## 子文档

| 文档 | 职责 |
|---|---|
| [认知—行动—学习闭环方法论](methodology/cognitive-action-learning-system.md) | 独立、完整的核心体系：主张、边界、对象模型、操作协议、质量控制与验证框架 |
| [多主体互动的极速假设协议](methodology/multi-party-fast-hypothesis-protocol.md) | v0.3 子协议：在高压互动中保留事实、执行可逆探针，并将失效互动路由回主闭环 |
| [最小可验证方法论](methodology/minimum-viable-method.md) | 核心命题、六个最小问题、验证单位、实验方法、否定条件与 Windows 示例 |
| [语义模型与适用边界](methodology/semantic-model-and-boundaries.md) | 核心对象、Feedback 生命周期、World Model、内容边界和事项模式 |
| [理论证据与案例](methodology/evidence-and-cases.md) | 理论依据、AAR、Good Judgment、Google SRE、NASA 反例和证据分层 |

## 当前结论

现有研究支持一个有边界的判断：

> 对需要跨时间还原事前认知的复盘，可靠保存行动前后的状态是关键基础条件，但它不是所有学习的必要条件，更不是充分条件。

真正可能产生效果的是：

```text
事前基线
  → 相关 Feedback
  → 受约束的 Review
  → 明确 Revision
  → 情境化检索
  → 下一次实际应用
```

证据强度并不均匀：

- 事前记录有助于揭示后见偏差和结果偏差，机制支持较强。
- 结构化 AAR 在边界明确、可重复的任务中有较好的表现证据。
- Revision 跨情境迁移需要主动检索和明确适用条件，只得到有条件支持。
- “减少个人长期重复错误”和“提高宽泛 Goal 达成率”尚未被整体验证。
- 完整对象体系是否优于简单 Decision Journal，目前没有证据。

因此，当前优先验证的不是“用户是否写了更多复盘”，而是：

> 相比自由记录或简单 Decision Journal，最小闭环能否以可接受成本，更准确地保留事前判断、发现认知差异，并让 Revision 在下一次相似事项中实际影响 Decision 或 Action？

如果简单日志、静态模板或一次 Agent 会话以更低成本产生相同效果，就应收缩方法，而不是增加概念维持复杂度。

v0.3 进一步把这一收缩原则变成运行规则：按可用决策时间选择记录强度；对复杂系统限制单次结果能够支持的因果结论；在高风险或重复失败事项中，引入反证与独立质询，而不把它们留作实践者自行提醒。

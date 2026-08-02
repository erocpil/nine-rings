# 语义模型与适用边界

> 所属：[认知与行动方法论](../cognitive-action-methodology.md)
> 相邻：[最小可验证方法论](minimum-viable-method.md) · [理论证据与案例](evidence-and-cases.md)

本文定义 Source、Claim、Decision、Feedback、Review、Revision 与 World Model 等概念的边界，并说明不同事项模式需要的记录强度。

## 3. 内容与认知模型的边界

被档案或辅助工具保存的内容，不等于用户相信的内容；系统提取出的 Claim，也不等于已经修改了用户的认知模型。

内容应区分为四层：

1. **Source**：书籍摘录、网页、技术文档、会议记录和原始观察。
2. **Candidate Claim**：系统从来源或记录中提取出的候选判断。
3. **Accepted Claim / Revision**：用户确认自己接受、修正、限定或拒绝了某个判断。
4. **Operational Model**：会实际影响预测、决策或行动的当前认识。

World Model 主要由第三、第四层生成。Source 是证据与上下文，Candidate Claim 是待确认建议，二者不能自动代表用户立场。

判断一段内容是否参与认知模型，可以依次询问：

1. 它包含什么 Claim？
2. Claim 属于外部作者、系统事实，还是用户自己的判断？
3. 用户是否接受、拒绝或据此修正了原判断？
4. 它是否可能改变预测、决策或行动？

只有前两项时，它主要属于知识与来源管理；进入后三项后，它才开始参与个人认知模型的演化。

## 4. 不同类型文档如何修正认知模型

《乌合之众》读书笔记和 bless 技术文档都可能产生有效 Revision，但它们的默认身份、证据性质和验证方式不同。

| 内容 | 默认身份 | 进入认知模型的条件 | 主要验证方式 |
|---|---|---|---|
| 《乌合之众》摘录 | 外部作者的观点或证据 | 用户明确接受、质疑或据此修正了某个 Claim | 其他研究、现实观察、预测和行为结果 |
| bless 技术文档 | 系统事实、设计意图或操作参考 | 用户据此改变了对 bless 的理解、技术判断或实施决策 | 当前源码、测试、运行结果、版本和 CI |

仅记录“勒庞认为群体中的个人更容易受暗示”仍然只是 Source。记录“我原来认为群体判断主要受信息不足影响；现在认为身份认同和情绪传播可能更重要，但对勒庞的普遍化结论仍存疑”才构成候选 Revision。

同样，仅保存 bless 调度器文档主要是在维护项目知识。如果用户记录“我原以为该调度路径由周期定时器驱动；检查文档与代码后确认它主要由事件触发，因此改变了延迟问题的排查方向”，它才成为与技术 Decision 相连的 Revision。

技术文档也不能自动视为 Reality。文档可能过时，设计意图可能与实际行为不同。对于 bless 这类工程内容，通常应按以下顺序评估证据：

```text
运行结果 / 测试
  ↓
当前源码
  ↓
当前版本文档
  ↓
历史文档
```

书籍观点则需要保留作者、时代背景、研究争议和适用范围，不能沿用技术文档的验证方式。实践记录应统一维护它们的来源和 Revision 历史，但不能使用同一种可信度计算解释所有内容。

## 5. 实践、认知闭环与 Feedback

Feedback 是连接目标、行动、现实、收益判断和认知更新的关键中介，也是“认知可观测性”能够成立的基础。

完整闭环可以表示为：

```text
Goal ──→ Desired Outcome ──→ Success Criteria
  ↓
Source / Observation ──→ Claim / World Model
        ↓
Decision ──→ Prediction ──────────────────┐
  ↓                                       │
Action ──→ Cost ──→ Reality ──→ Outcome  │
                             ↓            │
                          Feedback ←──────┘
                             ↓
                           Review
                             ↓
             Evidence Assessment / Benefit 判断
                             ↓
                          Revision
                             ↓
                    更新 World Model
                             ↓
             影响下一次 Decision 与 Action
```

这是一条典型路径，不是强制的线性流程。Claim 可以来自阅读，也可以来自行动后的观察；Feedback 可能直接削弱一个 Prediction，也可能只暴露 Decision 的执行问题；Outcome 可能符合 Success Criteria 却因 Cost 过高而没有产生净 Benefit；一次 Review 也可以得出“证据不足，不产生 Revision”。

### 5.1 核心对象的语义

| 对象 | 定义 | 不应混淆为 |
|---|---|---|
| Goal | 用户认为值得追求的问题方向、状态变化或价值目标，回答“为什么做” | 具体任务清单或已经实现的结果 |
| Non-goal | 当前事项明确不追求、不优化或不纳入范围的结果，用于限制系统和行动边界 | 没有价值、永远不做或禁止发生 |
| Constraint / Guardrail | 即使有助于 Goal 也不能突破，或必须满足的伦理、法律、资源和关系边界 | 可以用更高 Benefit 抵消的普通 Cost |
| Exploration Question | 暂时没有固定 Desired Outcome 时，希望通过观察、阅读或实验澄清的问题 | 伪装成开放探索的无限拖延 |
| Desired Outcome | 为某个 Goal 希望在特定范围和时间内出现的可观察结果，回答“想得到什么” | 对实际会发生什么的 Prediction |
| Success Criteria | 事前定义的判断条件、阈值、时间窗口和最低可接受结果，回答“怎样算成功” | 事后为了匹配结果而修改的解释 |
| Cost | 为 Decision 和 Action 预期或实际付出的时间、金钱、注意力、机会、风险及副作用 | 只包含财务支出 |
| Source | 原始书籍、文档、网页、对话、日志或数据来源 | 用户已经接受的观点 |
| Observation | 用户或系统记录到的现象 | 已经解释过的因果结论 |
| Claim | 带有语境、范围、状态和置信度的可讨论判断 | 客观真理 |
| Decision | 在特定时间和约束下对选项作出的承诺 | 实际执行结果 |
| Prediction | Claim 或 Decision 对未来可观察结果的预期 | 用户希望发生的目标 |
| Action | 为执行 Decision 实际采取的行为 | Decision 本身 |
| Reality | 无论是否被用户注意，实际发生的事件或状态 | 系统接收到的 Feedback |
| Outcome | 与 Goal、Decision 或 Action 相关的实际结果，是 Reality 中被划定和测量的一部分 | Goal、Desired Outcome 或 Decision 质量本身 |
| Benefit | Outcome 对用户或相关方产生的价值，需要结合 Goal、Cost、风险、时间和副作用判断 | Outcome 数值、活动量或短期正反馈 |
| Feedback | 通过人、测试、监控、文档或 Agent 接收到的信号 | 已经完成可信度评估的 Evidence |
| Review | 对 Feedback、语境和替代解释进行检查的过程 | 普通摘要 |
| Evidence Assessment | 某个 Feedback 或 Source 对特定 Claim 的支持方向、强度与可信度判断 | 原始信号本身 |
| Revision | 用户确认的正式认知更新，保留更新前后状态及依据 | 任意文本修改或自动摘要变化 |
| World Model | 从当前有效 Claim、Revision、Evidence 和冲突生成的可追溯投影 | 完整、唯一或绝对正确的现实模型 |

最简洁的区分是：

> Goal 说明为什么做，Desired Outcome 说明想得到什么，Success Criteria 说明怎样算成功，Prediction 说明基于当前认识预计会发生什么，Outcome 说明实际得到什么，Cost 说明为此付出了什么，Benefit 说明这些结果是否值得。

同时：

> Reality 是发生的事实，Feedback 是被接收到的信号，Review 是解释信号的过程，Evidence Assessment 是解释后的认知依据，Revision 是据此发生的正式认知更新。

这些概念不能简单折叠为一个“任务是否完成”字段：

- Goal 可以长期存在，而不同阶段具有不同 Desired Outcome。
- Non-goal 用来明确当前不优化什么；Constraint 用来明确无论多大收益都不能轻易突破什么。
- Goal 和 Non-goal 不是对所有生活内容的二元分类。开放探索可能只有 Exploration Question，非工具性活动也可以不建立任何 Goal。
- Desired Outcome 表达愿望，Prediction 表达基于当前证据的预期；两者不一致时尤其值得记录。
- Success Criteria 应尽量在行动前冻结版本，后续调整必须保留修改时间和原因。
- Outcome 可能达到标准但不产生 Benefit，例如成本、风险或副作用超过预期。
- Benefit 也可能延迟出现，包括直接结果、能力提升、避免损失和未来选择权。
- World Model 只负责提高判断质量，不能替用户定义什么具有价值。

建议的最小数据语义为：

```text
Goal
  ├─ statement / scope / owner
  ├─ status / time_horizon
  ├─ non_goals / constraints
  └─ related_goal_ids

Desired Outcome
  ├─ goal_id
  ├─ observable_state
  └─ target_time

Success Criteria
  ├─ desired_outcome_id
  ├─ metric / condition / threshold / time_window
  ├─ version / defined_at
  └─ changed_at / change_reason

Cost
  ├─ decision_id / action_id
  ├─ expected_or_actual
  ├─ type / amount / unit
  └─ risk / opportunity_cost / side_effect

Outcome
  ├─ goal_id / decision_id / action_id
  ├─ observed_state / measured_value
  ├─ occurred_at / observed_at
  └─ source / context / uncertainty

Benefit Assessment
  ├─ outcome_id / beneficiary
  ├─ value_type / time_horizon
  ├─ cost_and_risk_considered
  ├─ positive / negative / mixed / unknown
  └─ assessed_by / assessed_at / confidence
```

一个 Goal 可以包含多个 Desired Outcome；同一个 Desired Outcome 可以有多个带版本的 Success Criteria；一个 Outcome 也可能对不同受益方形成不同甚至冲突的 Benefit Assessment。原始 Outcome 与 Benefit Assessment 必须分离，理由与 Feedback 和 Evidence Assessment 分离相同：事实结果不能被后续价值解释覆盖。

### 5.2 Feedback 为什么可能成为一等对象

Feedback 具有独立于普通笔记的生命周期：

- **来源**：人、测试、监控、文档、Agent、用户自身或外部环境。
- **目标**：Claim、Decision、Prediction、Action，或者 所使用工具或辅助过程本身。
- **时间**：发生时间、被观察时间和被记录时间可能不同。
- **渠道**：对话、日志、指标、测试报告、评论、问卷或自动事件。
- **形式**：定量、定性、主观、客观、结构化或非结构化。
- **时效**：即时、延迟、周期性或长期累积。
- **处理状态**：未处理、待澄清、已 Review、已形成 Evidence Assessment、存在争议或已忽略。
- **原始内容**：必须保留未经系统解释的原文、数值或来源引用。

一条 Feedback 可以关联多个目标，并且对不同目标具有不同含义。例如“延迟上升”可能削弱“新算法会降低延迟”的 Claim，但不能直接证明选择该算法的 Decision 在当时就是不合理的。

同一个 Reality 也可能产生相互冲突的 Feedback：性能指标显示延迟上升，用户主观感受却认为软件更流畅。系统应并列保存这些信号，等待 Review，而不是自动合并成单一结论。

### 5.3 原始 Feedback 与解释必须分离

Feedback 本身不应直接携带不可撤销的“支持 / 削弱”结论。更稳健的数据语义是：

```text
Feedback
  ├─ 原始来源与内容
  ├─ 发生 / 观察 / 记录时间
  ├─ 可能关联的目标
  └─ 未解释状态

Evidence Assessment
  ├─ 针对哪个 Claim / Prediction / Decision
  ├─ 支持 / 削弱 / 冲突 / 无法判断
  ├─ 证据强度
  ├─ 来源可信度
  ├─ 适用语境
  ├─ 替代解释
  └─ 谁在何时完成评估
```

这样，同一条 Feedback 可以被不同 Review 以不同方式解释，新的信息也可以推翻旧的 Evidence Assessment，而不需要修改原始记录。

### 5.4 Feedback 的生命周期

推荐生命周期为：

```text
Captured
  ↓
Triaged
  ├─ 与现有对象无关 → Archive / Ignore
  ├─ 信息不足 → Needs Clarification
  └─ 可能相关 → Pending Review
                         ↓
                       Review
                         ↓
               Evidence Assessment
                         ↓
          保持原 Claim / 产生 Revision / 保留争议
```

其中：

- Capture 只负责忠实保存信号。
- Triage 可以由 Agent 自动完成，但必须允许撤销。
- Review 负责检查目标、来源、语境、测量误差和替代解释。
- 只有预先定义、机器可验证的测试结果，才适合自动生成确定性较高的 Evidence Assessment。
- 涉及用户立场、因果归因或价值判断时，必须由用户确认是否产生 Revision。

### 5.5 Decision 应主动设计 Feedback

高质量 Feedback 不应完全依赖事后偶然发现。重要 Decision 在执行前应尽量定义：

- 它服务于哪个 Goal。
- Desired Outcome 是什么。
- Success Criteria、最低可接受结果和时间窗口是什么。
- 可以接受的预算、时间、风险和机会成本是什么。
- 希望观察什么结果。
- 哪些指标或现象能够代表结果。
- 通过哪些渠道收集 Feedback。
- 何时检查，持续观察多久。
- 什么结果支持或削弱关键 Claim。
- 哪些外部条件会使结果无法判断。
- 如果反馈不符合预期，允许采取什么调整。

因此 Decision 不只是“选择了什么”，还应包含最小验证协议：

```text
Decision
  ├─ Goal / Desired Outcome
  ├─ Success Criteria
  ├─ 选项、约束与预期 Cost
  ├─ 当时依据的 Claim
  ├─ Prediction
  ├─ Feedback Channel
  ├─ Review Time
  └─ Adjustment Condition
```

这可以减少事后挑选有利证据、隐藏真实成本和重新解释成功标准。Success Criteria 发生变化时，应创建新版本并保留原定义，而不是覆盖历史。

### 5.6 Feedback、Review 与 World Model 的关系

Feedback 不应直接写入 World Model。推荐更新路径是：

```text
Outcome / Cost / Feedback
  ↓
Review
  ↓
Success Criteria 与 Benefit 判断
  ↓
Evidence Assessment
  ↓
用户确认 Revision 或保留原 Claim
  ↓
重新生成 World Model 投影
```

World Model 同时会反过来影响用户关注哪些 Feedback，形成选择性注意的风险：

```text
已有 World Model
  ↓
决定关注哪些信号
  ↓
更容易看到符合预期的 Feedback
  ↓
进一步强化原模型
```

实践记录应保留反例、未解决冲突、被忽略的 Feedback 及忽略原因，并在 Review 时主动提示可能的确认偏误。

World Model 也不应直接决定 Goal 或 Benefit。它可以帮助用户判断“怎样做更可能成功”，但“什么值得追求”“哪些成本可以接受”“结果对谁有价值”仍包含个人偏好、伦理和利益分配，必须由用户或相关方确认。

### 5.7 主要失败模式

Feedback 进入认知系统时，需要防范：

- **确认偏误**：只记录与原判断一致的信号。
- **代理指标失真**：指标可测量，但并不代表真正目标。
- **Goodhart 效应**：指标成为目标后失去原有解释力。
- **归因错误**：把结果简单归因给某个 Decision，忽略执行和外部条件。
- **结果偏误**：仅凭 Outcome 好坏评价当时 Decision，忽略当时可获得的信息与概率。
- **目标替代**：容易测量的指标逐渐取代真正的 Goal 或 Benefit。
- **沉没成本**：因为已经付出 Cost 而继续维持低价值 Decision。
- **收益错配**：Benefit 由一方获得，Cost、风险或副作用却由另一方承担。
- **延迟反馈**：短期结果与长期结果方向相反。
- **缺失反馈**：没有收到信号不等于现实没有发生变化。
- **来源相关性**：多个反馈实际来自同一个上游来源，却被误认为独立证据。
- **幸存者偏差**：只观察成功或仍然可见的案例。
- **主观与客观混淆**：感受、意见、指标和事实被放在同一可信度层级。
- **Agent 放大**：Agent 重复总结同一来源，制造“多个证据”的假象。
- **事后标准漂移**：看到结果后修改原 Prediction 或成功条件。

所有自动推导都应保留来源引用、生成者、模型或 Skill 版本、时间和可撤销状态。

## 6. 从知识管理到实践收益

知识管理、认知升级和现实收益之间不是自动关系，而是一条可能中断的转化链：

```text
知识被记录
  ↓
形成可用理解
  ↓
改变 Decision
  ↓
影响 Action
  ↓
产生 Outcome
  ↓
在扣除 Cost、风险和副作用后形成 Benefit
```

任何一层都可能失败：知识可能没有被检索，理解可能错误，Decision 可能没有执行，Action 可能质量不足，外部条件可能改变，Outcome 也可能因为成本过高而没有价值。因此该方法应帮助实践者定位链条在哪一层断裂，而不是把所有成败都归因于“认知是否正确”。

Review 至少要分别检查：

1. **目标质量**：Goal 是否仍值得追求，Desired Outcome 是否真正代表用户需要的价值。
2. **认知质量**：当时使用的 Claim、证据、假设和 World Model 是否合理。
3. **决策质量**：在当时可获得的信息和约束下，Decision 是否合理，Prediction 是否校准。
4. **执行质量**：Action 是否实际完成，方法、时机和投入是否符合计划。
5. **外部条件**：运气、环境变化和第三方行为对 Outcome 有多大影响。
6. **测量质量**：Feedback 是否完整，Success Criteria 和指标是否真的代表 Goal。
7. **价值判断**：Outcome 在考虑 Cost、风险、副作用和受益对象后，是否形成了值得保留的 Benefit。

这可以避免两种常见错误：

- 好 Decision 因偶然因素得到坏 Outcome，于是被错误否定。
- 坏 Decision 因运气得到好 Outcome，于是被错误强化。

Benefit 不只包括经济收入，也包括完成项目、解决问题、掌握技能、节省时间、避免损失、降低风险、改善关系和获得未来选择权。部分阅读、探索和基础研究不会立即产生 Outcome，但可以形成延迟收益或认知期权；系统不应强迫所有知识立即绑定任务，只需在它真正影响 Goal、Decision 或 Action 时建立关联。

## 7. 适用边界：先识别事项模式

“提高达成有价值目标的概率，并降低时间、成本、风险和重复犯错”是一个有用的二阶方向，但不是大多数人面对大多数事情时都应执行的普遍准则。它没有回答 Goal 是否值得、谁获得 Benefit、谁承担 Cost，也可能鼓励用户选择容易成功但价值有限的目标。

时间、成本、风险和成功概率通常相互冲突。创新、学习和长期关系可能需要更多投入并承担合理风险。因此该方法不应承诺同时最小化所有 Cost，而应帮助用户在约束和不确定性下作出可解释的取舍。

在要求用户定义 Goal 之前，应先判断当前事项属于哪种模式：

```text
记录、想法或现实事项
          ↓
     这是什么模式？
          │
          ├─ 目标导向事项
          │     ↓
          │  Goal / Non-goals / Constraints
          │     ↓
          │  Desired Outcome / Success Criteria
          │     ↓
          │  Decision → Action → Outcome → Review
          │
          ├─ 开放探索
          │     ↓
          │  Exploration Question / 可接受 Cost / Stop Condition
          │     ↓
          │  Observation → Claim 候选 → 决定是否形成 Goal
          │
          ├─ 例行维护
          │     ↓
          │  Trigger / Checklist / Exception / Service Level
          │
          ├─ 非工具性活动
          │     ↓
          │  普通记录即可，不要求 Outcome 或 Benefit 证明
          │
          └─ 低风险且无需管理
                ↓
             不记录或快速处理
```

| 事项模式 | 典型例子 | 建议结构 |
|---|---|---|
| 目标导向 | 完成项目、解决故障、学习技能、健康改善 | 完整或轻量的 Goal → Outcome → Review |
| 开放探索 | 阅读陌生领域、基础研究、尝试新方向 | 问题、观察、来源、预算和停止条件，不强制预设结论 |
| 例行维护 | 备份、例行检查、周期整理 | 模板、清单、异常和趋势，避免重复填写完整 Goal |
| 非工具性活动 | 休息、游戏、审美体验、陪伴和部分关系互动 | 可记录但默认不量化、不评分、不要求产生外部收益 |
| 无需管理 | 低成本、可逆、一次性的日常选择 | 不增加记录负担 |

对目标导向事项，也不能只区分 Goal 与 Non-goal。至少还要分清：

1. **Goal**：当前希望推动的价值方向。
2. **Non-goals**：本次明确不追求、不优化或不纳入范围的结果。
3. **Constraints / Guardrails**：即使有助于 Goal，也不应突破的边界。
4. **Unknowns**：目前尚不清楚、需要探索的问题。
5. **Trade-offs**：为了某个 Outcome 愿意接受和不愿接受的 Cost、风险与副作用。

Non-goal 是范围声明，不是价值否定。例如“本阶段不追求商业化”不等于商业化永远没有价值；“这次阅读不要求立刻产出项目”也不等于阅读没有收益。

闭环强度应与事项本身成比例：

```text
低成本、可逆、低影响
  → 普通记录或不记录

重复出现、具有一定不确定性
  → Goal + Decision + Outcome 的轻量闭环

高影响、高成本、长期、不可逆或容易重复犯错
  → Success Criteria + Prediction + Cost + Feedback + Review 的完整闭环
```

是否值得进入更重的闭环，可以粗略考虑：

```text
预期价值
× 事项影响
× 不确定性
× 未来复用概率
× 可获得 Feedback 的程度
      是否明显高于
记录、确认和回顾造成的摩擦
```

这不是要求实践者计算一个伪精确分数，而是用于选择记录与复盘强度：该方法应允许用户容易升级或降级记录强度，并把“不进入闭环”视为正常选择。

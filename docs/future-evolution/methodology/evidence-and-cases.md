# 理论证据与案例

> 所属：[认知与行动方法论](../cognitive-action-methodology.md)
> 相邻：[最小可验证方法论](minimum-viable-method.md) · [语义模型与适用边界](semantic-model-and-boundaries.md)

本文汇总方法各组件的理论依据、实证支持、成功实践、失败反例和证据边界。相邻领域的成功只能支持低成本验证，不能代替 Nine Rings 方法本身的对照实验。

## 8. 理论依据：综合框架而非单一理论

Goal、Non-goals、Constraints、Unknowns、Trade-offs、Desired Outcome 和 Success Criteria 并不是某个学派提出并整体完成实证验证的一套标准方法。它们是目标设定、决策分析、系统工程、项目范围管理、项目评估和科学预注册等传统的交集。

| 概念 | 主要理论或实践来源 | 能够支持什么 | 不能证明什么 |
|---|---|---|---|
| Goal | 目标设定理论、价值聚焦思考 | 明确目标可以引导注意力、努力、持续性和策略选择 | Goal 本身值得追求，或越困难越好 |
| Non-goals | 产品设计、系统设计、项目范围管理 | 明确当前不解决什么，减少范围蔓延和无意识优化 | 被排除事项没有价值或永远不做 |
| Constraints | 系统工程、受约束决策 | 明确法规、安全、伦理、预算、接口等必须满足的边界 | 所有边界都能被准确预见或量化 |
| Unknowns | 有限理性、探索性研究 | 承认信息和计算能力有限，并决定先研究或实验什么 | 可以提前列出全部未知 |
| Trade-offs | 决策分析、多目标决策 | 显式比较多个价值维度、成本、风险和副作用 | 所有价值都能折算成一个客观分数 |
| Desired Outcome | Logic Model、Theory of Change | 区分活动、直接产物和希望产生的现实变化 | 活动一定导致 Outcome |
| Success Criteria | 目标设定、系统验证、科学预注册 | 事前约定怎样判断结果，减少事后标准漂移 | 指标一定代表真正的 Goal 或 Benefit |

### 8.1 Goal：目标设定理论

Locke 和 Latham 总结的目标设定研究表明，在条件适合时，明确且有挑战性的目标通常比“尽力做好”这类模糊要求更能改善任务表现。目标通过引导注意力、努力、持续性和策略选择发挥作用，但效果受目标承诺、反馈、能力和任务复杂度影响。

对于陌生、复杂、尚不知道正确策略的任务，刚性的绩效目标可能制造焦虑并损害学习；此时更适合先设置“发现若干有效策略”之类的学习目标。这为“目标导向事项”和“开放探索”必须分开提供了直接依据。

参考：[Locke & Latham, *Building a Practically Useful Theory of Goal Setting and Task Motivation*](https://www-2.rotman.utoronto.ca/facbios/file/09%20-%20Locke%20%26%20Latham%202002%20AP.pdf)

### 8.2 Goal 与 Trade-offs：价值聚焦思考

Ralph Keeney 的 Value-Focused Thinking 主张，决策不应从“目前有哪些选项”开始，而应先澄清真正重视的价值和基本目标，再据此创造与比较方案。

它区分：

- **Fundamental Objective**：最终为什么在意这件事。
- **Means Objective**：帮助实现根本目标的中间手段。
- **Value Trade-off**：多个目标不能同时最大化时，愿意如何取舍。

这提醒该方法：用户写下的 Goal 可能只是手段。例如“每天阅读两小时”通常不是根本目标，而是掌握某领域、改善判断或获得体验的手段。

参考：[Keeney, *Value-focused thinking: Identifying decision opportunities and creating alternatives*](https://www.sciencedirect.com/science/article/pii/0377221796000045)

### 8.3 Constraints 与 Success Criteria：系统工程

NASA 的系统工程方法会在项目早期明确 stakeholder needs、goals、objectives、constraints、success criteria、成本和运行环境，并要求将关键期望基线化；后续变化需要经过可追溯的调整过程。

Constraint 是必须满足的条件，可能来自法规、安全、技术状态、外部接口或预算。它不同于普通 Trade-off：法律、伦理和安全边界原则上不能因为预期 Benefit 更高就被无痕抵消。

参考：[NASA Systems Engineering Handbook](https://www.nasa.gov/wp-content/uploads/2018/09/nasa_systems_engineering_handbook_0.pdf)

### 8.4 Non-goals：工程范围管理惯例

Non-goals 并不是一个成熟统一的心理学概念，它主要来自产品、系统设计和项目范围管理。设计文档同时写 Goals 与 Non-goals，是为了让实施者和评审者知道当前试图解决什么、明确不解决什么，以及如何防止范围无限扩张。

例如 Kubernetes Enhancement Proposal 模板会并列要求 Goals、Non-Goals、Constraints / Caveats、Risks、Mitigations 和 Test Plan。

参考：[Kubernetes KEP 模板](https://github.com/kubernetes/enhancements/blob/master/keps/NNNN-kep-template/README.md)

### 8.5 Unknowns：有限理性与探索

Herbert Simon 的有限理性指出，现实决策者无法掌握全部选项、外部事件和后果，也没有无限计算能力。因此实际决策通常需要搜索并寻找“足够好”的方案，而不是假设能够计算全局最优。

Unknowns 至少应区分：

- 可以通过调查减少的未知。
- 只能通过行动或实验获得的未知。
- 暂时无法消除、只能纳入风险的未知。
- 当前尚未意识到的 unknown unknowns。

参考：[Simon, *Rational Decision-Making in Business Organizations*](https://www.nobelprize.org/uploads/2018/06/simon-lecture.pdf)

### 8.6 Desired Outcome：Logic Model

Logic Model 通常区分：

```text
Inputs → Activities → Outputs → Outcomes
```

“举办十次培训”是活动或 Output，不等于“参与者能力提高”这个 Outcome。上下文、外部条件和隐含假设都会影响活动能否产生期望结果。

这支持该方法区分 Action、直接产物、Outcome 与 Benefit，而不是把“任务完成”直接视为“目标实现”。

参考：[CDC Logic Models](https://www.cdc.gov/library/research-guides/logic-models.html)

### 8.7 Success Criteria：科学预注册

科学预注册要求在看到结果前记录研究问题、假设、方法、变量和分析计划，其核心价值是区分事前计划的验证与看到数据以后产生的探索。

它不是禁止修改计划，而是要求透明保存“原来计划什么、后来为什么改变”。这与该方法要求为 Success Criteria、Prediction 和预期 Cost 保存事前版本一致，可以减少事后修改成功标准、选择性报告和根据 Outcome 重写原 Decision 理由。

参考：[Center for Open Science, Preregistration](https://www.cos.io/initiatives/prereg)

### 8.8 从 Goal 到 Action：实施意图

明确 Goal 并不足以保证执行。Gollwitzer 的 Implementation Intentions 研究将目标进一步转化为“如果出现情境 X，就执行行动 Y”的计划，用预先识别的情境线索触发行动。

这说明该方法如果要连接认知与现实，除了保存 Goal 和 Decision，还需要允许用户表达触发条件、下一步行动和调整条件。

参考：[Gollwitzer, *Implementation Intentions: Strong Effects of Simple Plans*](https://www.socmot.uni-konstanz.de/publications/implementation-intentions-strong-effects-simple-plans)

### 8.9 证据强度与局限

上述来源支持的是不同组件，而不是这些组件组合后的整体有效性：

- Goal、反馈和行动计划具有较多行为研究基础。
- Constraints、Non-goals 和 Success Criteria 具有较强工程实践支持。
- Unknowns 和 Trade-offs 有决策理论支持，但实际质量高度依赖使用者、情境和信息。
- 将这些概念组合进个人 PKM 后是否改善长期 Decision、Outcome 或 Benefit，目前没有直接证据。

填写完整字段也不等于完成高质量思考。结构只能使问题显性化，不能保证 Goal 正确、Unknowns 完整、Trade-offs 合理或因果解释可靠。

因此，这套框架更适合被描述为：

> 一套降低目标、范围、约束、未知、取舍和成功标准被无意混淆的决策脚手架，而不是一套保证成功的方法。

## 9. 针对“事前认识 → 事后结果 → 下一次实践”的证据

### 9.1 有条件成立，而不是自动成立

现有研究能够支持以下较窄结论：

> 保存事前判断、获得与任务相关的 Feedback、进行结构化 Review，并把结论用于下一次相似实践，通常比只凭事后记忆更有利于发现判断偏差和改善后续表现。

它不能直接证明：

- 只要写下日志就会减少错误。
- 任意领域都能获得及时、可靠且可归因的 Feedback。
- 一次 Review 就能形成可以迁移的知识。
- 个人长期 Goal 的达成率一定提高。
- 完整认知对象体系比简单决策日志更有效。

证据主要支持闭环中的不同组件，而不是本文全部概念组合后的整体因果效果。

### 9.2 事前记录为什么必要：后见之明与结果偏差

Fischhoff 的经典实验显示，人知道 Outcome 后，会提高对该结果事前可预测程度的判断，并且通常意识不到 Outcome knowledge 已经改变了自己的解释。这会限制人从过去准确学习。

参考：[Fischhoff, *Hindsight is not equal to foresight*](https://doi.org/10.1037/0096-1523.1.3.288)

Fischhoff 与 Beyth 让参与者在尼克松访问北京和莫斯科前估计多个事件的概率，事后再回忆原预测。回忆值会向已经发生的 Outcome 移动。这说明“我记得自己当时怎么想”不是可靠基线。

参考：[Fischhoff & Beyth, *I Knew It Would Happen*](https://doi.org/10.1016/0030-5073%2875%2990002-1)

Baron 与 Hershey 研究了 Outcome Bias：即使 Decision 的信息和过程相同，人仍会因为最终结果好坏而不同地评价 Decision 质量。后续预注册的大样本复制也再次观察到这一方向。

参考：[Baron & Hershey, *Outcome Bias in Decision Evaluation*](https://doi.org/10.1037/0022-3514.54.4.569) · [预注册复制研究](https://pmc.ncbi.nlm.nih.gov/articles/PMC12372742/)

因此，事前快照的核心价值不是提升记忆容量，而是让实践者能够：

- 用当时的信息状态评价当时的 Decision。
- 区分好 Decision 遇到坏 Outcome，与坏 Decision 碰巧得到好 Outcome。
- 看见 Success Criteria、置信度和理由是否在事后漂移。

### 9.3 为什么需要完整反馈循环：自我调节学习

Self-Regulated Learning 将学习描述为循环：

```text
Forethought
  → Performance
  → Self-reflection
  → 影响下一轮 Forethought
```

其中 Forethought 包含目标与策略，Performance 包含执行和监控，Self-reflection 包含自我评价、因果归因和对下一轮方法的调整。这与本文“事前判断 → 行动 → Feedback → Review → Revision”的结构高度一致。

参考：[Cleary, Platten & Nelson, *Effectiveness of the Self-Regulation Empowerment Program*](https://files.eric.ed.gov/fulltext/EJ835869.pdf)

但 Feedback 并非天然有益。Kluger 与 DeNisi 对 607 个效应量、23,663 个观察的元分析发现，Feedback Intervention 平均改善表现，但超过三分之一的干预反而降低表现。Feedback 是否聚焦任务、是否可行动，以及是否把注意力错误地转向自我评价，都会影响结果。

参考：[Kluger & DeNisi, *The Effects of Feedback Interventions on Performance*](https://doi.org/10.1037/0033-2909.119.2.254)

这要求本方法避免把 Feedback 变成“你做得好不好”的人格评分，而应聚焦：

- 预期与实际的任务差异。
- 哪个步骤、假设或外部条件需要调整。
- 下一次可以执行的具体变化。

Deliberate Practice 研究也把明确任务、及时且信息充分的 Feedback、问题分析和再次练习视为提高专业表现的重要组合。但它主要适用于具有相对明确表现标准、可以反复练习的领域，不能直接证明宽泛人生 Decision 也遵循同样效果。

参考：[Ericsson, *Deliberate Practice and Acquisition of Expert Performance*](https://doi.org/10.1111/j.1553-2712.2008.00227.x)

### 9.4 结构化 Review 是否改善表现：After-Action Review

After-Action Review 通常比较：

1. 原计划或标准是什么？
2. 实际发生了什么？
3. 为什么出现差异？
4. 下一次怎样调整？

一项涵盖 61 项研究、915 个团队和 3,499 名个体的元分析报告，AAR / debrief 对多类训练评价指标的总体改善效应为 `d = 0.79`；与个人或团队层次对齐，以及使用客观表现材料，是较稳定的有利条件。

参考：[Keiser & Arthur, *A meta-analysis of the effectiveness of the after-action review*](https://pubmed.ncbi.nlm.nih.gov/32852990/)

这为“比较预期与实际、基于客观 Feedback 复盘、形成下一次计划”提供了目前最直接的实证支持之一。但研究主要来自训练与任务表现，不能直接外推到宽泛的人生 Goal 或长期 World Model。

### 9.5 明确 Prediction 并持续校准：Good Judgment Project

Good Judgment Project 在 IARPA 的地缘政治预测竞赛中要求参与者对可验证事件给出概率预测，并随着新信息持续更新。研究发现，一组高表现预测者能够在大量问题和不同主题中维持较高准确度；研究者将表现解释为能力、任务技能、动机和有利环境的共同作用。

参考：[Mellers et al., *Identifying and cultivating superforecasters*](https://pubmed.ncbi.nlm.nih.gov/25987508/) · [IARPA ACE 项目与公开数据](https://www.iarpa.gov/newsroom/article/iarpa-announces-publication-of-data-from-the-good-judgment-project)

它支持的不是“写日记有用”，而是一个更具体的组合：

- Prediction 必须足够明确，能够被评分。
- Outcome 必须有预先定义的判定方式。
- 实践者反复收到校准 Feedback。
- 判断可以在新信息出现时更新。
- 表现跨多个问题累计，而不是只挑成功案例。

不过，后续方法学分析对“团队合作和短期训练各自造成了多少提升”的原始因果解释提出了质疑，说明优秀表现不能全部归因于某一个记录或训练环节。

参考：[APS, *Rethinking the Role of Teams and Training in Geopolitical Forecasting*](https://www.psychologicalscience.org/journals/psychological-science/09567976241266481/)

学习迁移研究还提示，仅保存或重复阅读一条结论通常不足以迁移。让学习者在不同例子中主动检索和应用同一概念，更有利于在新例子中使用它。这只能作为“Revision 需要在多个相似情境中被调用”的相邻证据，不能直接证明个人 Decision Journal 的长期效果。

参考：[Butler et al., *Retrieving and applying knowledge to different examples promotes transfer of learning*](https://pubmed.ncbi.nlm.nih.gov/29265856/)

### 9.6 成功实践案例及其证据等级

| 实践 | 与本方法的对应关系 | 能证明什么 | 不能证明什么 |
|---|---|---|---|
| 美军 After-Action Review | 对照预期与实际，发现原因，连接下一轮训练 | AAR 已成为标准化、跨层级的训练实践；相关元分析支持结构化 debrief 改善任务表现 | 军事训练效果不能直接外推到所有个人认知活动 |
| Good Judgment Project | 事前概率、可验证 Outcome、持续更新与评分 | 明确 Prediction 和长期反馈能够识别并培养更准确的预测实践 | 无法把效果完全归因于记录；选择、训练、团队和聚合算法同时存在 |
| Google SRE Postmortem | 保存事件、影响、处置、原因和防复发 Action Item，并跨团队共享 | 展示了高可靠性工程组织如何把事故记录连接到修复、责任人和趋势分析 | Google 对“更少故障”的结论主要是组织经验，不是随机对照因果证据 |
| 科学预注册 | 在看到结果前冻结问题、假设和分析计划 | 能区分事前验证与事后探索，减少无痕修改解释空间 | 不保证假设正确，也不保证研究或现实 Decision 成功 |

美军 FM 7-0 将 AAR 定义为用于改善未来表现的引导式分析，要求回顾原计划、实际发生、差异原因和下一次怎样达到标准，并明确把结果连接到后续训练。

参考：[U.S. Army FM 7-0, Appendix K: After Action Reviews](https://www.first.army.mil/Portals/102/FM%207-0%20Appendix%20K.pdf)

Google SRE 将重大事故后的无责 Postmortem 设为文化惯例，记录影响、处置、根因和防复发 Action Item，并聚合大量 Postmortem 做趋势分析。Google 报告这种持续投入与更少故障、更好的用户体验相关，但这仍属于实践组织的自我报告。

参考：[Google SRE, *Postmortem Culture: Learning from Failure*](https://sre.google/sre-book/postmortem-culture/)

### 9.7 失败反例：保存了 Lessons Learned，不等于会被复用

NASA Inspector General 在 2012 年审查 Lessons Learned Information System 时发现，项目经理并不经常检索或贡献经验。在被调查的 28 名项目经理中，16 人表示使用过系统，12 人贡献过经验；很多人认为系统过时、不易用、内容与当前项目不相关。

报告还指出，只在项目结束时捕获经验会降低及时性和完整性；部分中心没有把经验交叉引用到工程标准或日常流程。也就是说，一个正式、可搜索的经验库仍可能被边缘化。

参考：[NASA OIG, *Review of NASA’s Lessons Learned Information System*](https://oig.nasa.gov/docs/IG-12-012.pdf)

这个反例说明：

```text
保存
  ≠ 被检索
  ≠ 被理解
  ≠ 被采用
  ≠ 改变后续 Decision
  ≠ 减少重复错误
```

因此，本方法不能用“产生了多少 Revision”证明成功。至少还要观察：

- 相似情境出现时能否及时检索。
- 旧经验与当前语境是否足够相似。
- 实践者是否接受并应用。
- 应用后是否改变 Decision 或 Action。
- 后续 Outcome 是否支持这次迁移。

### 9.8 当前证据结论

综合来看，这个思路之所以合理，不是因为“反思总是有用”，而是因为它针对了几个已有证据支持的具体失真：

- Outcome 会重写人对事前可预测性的判断。
- Outcome 会污染对 Decision 质量的评价。
- 没有反馈和下一轮行动，经验不会自动转化为学习。
- 结构化、基于客观材料的 AAR 在训练任务中通常有效。
- 明确、可评分并反复更新的 Prediction 可以改善校准实践。
- 经验库如果缺少及时捕获、语境、检索和流程嵌入，通常不会自动被复用。

因此最稳健的结论是：

> 对需要跨时间还原事前认知的复盘，可靠保存行动前后的状态是关键基础条件，但它不是所有学习的必要条件，更不是充分条件。真正可能产生效果的是“事前基线、相关 Feedback、受约束的 Review、明确 Revision、情境化检索和下一次应用”组成的闭环。

Nine Rings 方法论第一阶段需要验证的，正是这个完整闭环相对于简单决策日志的增量价值，而不能用上述相邻领域的成功案例替代自身验证。

### 9.9 证据分层与方法论决策

将现有证据按命题强度分层，可以避免把相邻领域的成功直接当成整套方法已经成立：

| 命题 | 当前判断 | 主要依据与限制 |
|---|---|---|
| 事前记录有助于发现认知变化 | 机制支持较强，直接应用证据中等 | 后见偏差与结果偏差表明事后回忆不可靠；但“写下前后状态”本身的增量效果仍需与简单日志比较 |
| 结构化比较有助于改善重复任务 | 在边界明确、Feedback 较快的任务中证据中等到较强 | AAR / debrief 元分析支持任务表现改善；不能直接外推到所有个人活动 |
| Revision 能迁移到相似情境 | 有条件支持 | 主动检索、多个例子和明确使用条件有利于迁移；经验保存后仍可能无法检索或不适用于新语境 |
| 能减少个人长期重复错误 | 合理但尚未被整体验证 | 需要同时发生正确归因、Revision、及时检索、实际采用和后续 Outcome 验证 |
| 能提高宽泛 Goal 的长期达成率 | 当前证据不足 | Goal 异质，Outcome 受执行、环境、运气和选择偏差共同影响 |
| 完整对象体系优于简单 Decision Journal | 尚无证据 | 必须直接比较净收益，不能以概念完整或功能数量证明 |

因此，方法论第一阶段不应直接声称“帮助用户把大多数事情做得更好”。更可信的近端命题是：

> 相比自由记录或简单 Decision Journal，最小闭环能否以可接受成本，更准确地保留事前判断、发现认知差异、形成带适用条件的 Revision，并让它在下一次相似事项中实际影响 Decision 或 Action？

验证顺序应是：

```text
能否可靠还原事前状态
  ↓
能否获得相关 Feedback
  ↓
能否形成非事后合理化的 Review
  ↓
能否产生明确 Revision 或有依据地不 Revision
  ↓
能否在相似情境中及时检索
  ↓
是否实际改变 Decision / Action
  ↓
是否降低同类错误，且净收益为正
```

这里最重要的否定条件是：如果简单决策日志、静态模板或一次 Agent 会话以更低成本产生相同效果，就应收缩方法，而不是通过增加对象、字段或自动化来维护其复杂度。

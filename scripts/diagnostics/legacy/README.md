# 早期手动诊断

这些脚本保留早期 Delta/Markdown 转换的数据流实验，包含复制的转换实现，不作为当前产品实现或自动化测试的事实来源，也不加入常规 CI。

当前转换回归位于 `tests/delta-converter.test.ts`、`tests/md-parser.test.ts` 及对应浏览器测试。需要修改转换器时应运行这些正式回归；这里的旧脚本仅用于追溯。`serve.py` 仍是根目录的静态服务入口，未迁移或停用。

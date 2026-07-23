/// 文档类型中文标签（匹配 Tauri DocTree.tsx）
const Map<String, String> docTypeLabels = {
  'explanation': '解释',
  'how-to': '指南',
  'reference': '参考',
  'tutorial': '教程',
};

/// 文档类型图标（匹配 Tauri DocTree.tsx）
const Map<String, String> docTypeIcons = {
  'explanation': '📖',
  'how-to': '🔧',
  'reference': '📋',
  'tutorial': '🎓',
};

/// P.A.R.A. 文件夹图标（匹配 Tauri DocTree.tsx STATE_ICONS）
const Map<String, String> stateIcons = {
  'projects': '📁',
  'areas': '🌐',
  'references': '📚',
  'ideas': '💡',
  'archives': '📦',
  'daily': '📅',
};

/// 根路径选项（匹配 Tauri PropertiesPanel.tsx PATH_ROOT_OPTIONS）
class PathRootOption {
  final String value;
  final String label;

  const PathRootOption({required this.value, required this.label});
}

const List<PathRootOption> pathRootOptions = [
  PathRootOption(value: 'projects', label: '📁 Projects'),
  PathRootOption(value: 'areas', label: '🧩 Areas'),
  PathRootOption(value: 'references', label: '📚 References'),
  PathRootOption(value: 'ideas', label: '💡 Ideas'),
  PathRootOption(value: 'archives', label: '📦 Archives'),
];

/// 文档类型选项（匹配 Tauri DocCreateDialog.tsx DOC_TYPE_OPTIONS）
class DocTypeOption {
  final String value;
  final String label;
  final String desc;

  const DocTypeOption({
    required this.value,
    required this.label,
    required this.desc,
  });
}

const List<DocTypeOption> docTypeOptions = [
  DocTypeOption(
    value: 'explanation',
    label: '📖 解释',
    desc: '说明原理、设计思路、为什么',
  ),
  DocTypeOption(
    value: 'how-to',
    label: '🔧 指南',
    desc: '具体操作的步骤说明',
  ),
  DocTypeOption(
    value: 'reference',
    label: '📋 参考',
    desc: 'API 参数、配置项、速查表',
  ),
  DocTypeOption(
    value: 'tutorial',
    label: '🎓 教程',
    desc: '引导式从头到尾学完',
  ),
];

/// 创建对话框路径选项（匹配 Tauri DocCreateDialog.tsx PATH_OPTIONS）
class DocCreatePathOption {
  final String value;
  final String label;
  final String desc;

  const DocCreatePathOption({
    required this.value,
    required this.label,
    required this.desc,
  });
}

const List<DocCreatePathOption> docCreatePathOptions = [
  DocCreatePathOption(value: 'projects', label: '📁 Projects', desc: '活跃项目'),
  DocCreatePathOption(value: 'areas', label: '🧩 Areas', desc: '持续领域'),
  DocCreatePathOption(value: 'references', label: '📚 References', desc: '参考资料'),
  DocCreatePathOption(value: 'ideas', label: '💡 Ideas', desc: '缓冲想法'),
  DocCreatePathOption(value: 'archives', label: '📦 Archives', desc: '归档'),
];

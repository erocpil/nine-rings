import 'package:flutter/material.dart';
import '../constants/doc_constants.dart';

/// 文档类型徽章 — 显示 docType 图标和中文标签
///
/// 用于 NoteCard、NoteEditor 标题区、文档树、概念聚合等位置。
///
/// 参数：
/// - [docType]: 文档类型字符串，可为 null
/// - [readonly]: 只读状态，为 true 时显示 🔒
///
/// 使用示例：
/// ```dart
/// DocTypeBadge(docType: note.docType, readonly: note.readonly)
/// ```
class DocTypeBadge extends StatelessWidget {
  final String? docType;
  final bool readonly;

  const DocTypeBadge({
    super.key,
    this.docType,
    this.readonly = false,
  });

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    // 只读文档：显示锁图标，不使用 docType 图标
    if (readonly) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(4),
          color: theme.disabledColor.withOpacity(0.12),
        ),
        child: const Text(
          '🔒',
          style: TextStyle(fontSize: 11),
        ),
      );
    }

    // 无 docType: 不显示
    if (docType == null || docType!.isEmpty) {
      return const SizedBox.shrink();
    }

    final icon = docTypeIcons[docType] ?? '🧩';
    final label = docTypeLabels[docType] ?? docType!;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        color: theme.colorScheme.primary.withOpacity(0.1),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            icon,
            style: const TextStyle(fontSize: 11),
          ),
          const SizedBox(width: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w500,
              color: theme.colorScheme.primary,
            ),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';

class TagEditor extends StatelessWidget {
  final List<String> tags;
  final ValueChanged<List<String>> onChanged;

  const TagEditor({
    super.key,
    required this.tags,
    required this.onChanged,
  });

  void _addTag(BuildContext context) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('添加标签'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '标签名',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (v) {
            _doAdd(ctx, v);
          },
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
          TextButton(
            onPressed: () => _doAdd(ctx, controller.text),
            child: const Text('添加'),
          ),
        ],
      ),
    );
  }

  void _doAdd(BuildContext context, String value) {
    final trimmed = value.trim();
    if (trimmed.isNotEmpty && !tags.contains(trimmed)) {
      onChanged([...tags, trimmed]);
    }
    Navigator.pop(context);
  }

  void _removeTag(String tag) {
    onChanged(tags.where((t) => t != tag).toList());
  }

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 4,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        ...tags.map((tag) => Chip(
              label: Text(tag, style: const TextStyle(fontSize: 12)),
              deleteIcon: const Icon(Icons.close, size: 14),
              onDeleted: () => _removeTag(tag),
              visualDensity: VisualDensity.compact,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
            )),
        ActionChip(
          label: const Text('+标签', style: TextStyle(fontSize: 12)),
          onPressed: () => _addTag(context),
          visualDensity: VisualDensity.compact,
        ),
      ],
    );
  }
}

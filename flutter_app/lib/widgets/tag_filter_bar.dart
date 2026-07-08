import 'package:flutter/material.dart';

class TagFilterBar extends StatefulWidget {
  final List<String> allTags;
  final ValueChanged<String> onSelectTag;
  final VoidCallback onClear;

  const TagFilterBar({
    super.key,
    required this.allTags,
    required this.onSelectTag,
    required this.onClear,
  });

  @override
  State<TagFilterBar> createState() => _TagFilterBarState();
}

class _TagFilterBarState extends State<TagFilterBar> {
  String? _selectedTag;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: [
            if (_selectedTag != null)
              ActionChip(
                label: const Text('清除'),
                onPressed: () {
                  setState(() => _selectedTag = null);
                  widget.onClear();
                },
                avatar: const Icon(Icons.clear, size: 14),
                visualDensity: VisualDensity.compact,
              ),
            ...widget.allTags.map((tag) {
              final isSelected = _selectedTag == tag;
              return Padding(
                padding: const EdgeInsets.only(right: 4),
                child: FilterChip(
                  label: Text(tag, style: const TextStyle(fontSize: 12)),
                  selected: isSelected,
                  onSelected: (_) {
                    setState(() => _selectedTag = isSelected ? null : tag);
                    if (isSelected) {
                      widget.onClear();
                    } else {
                      widget.onSelectTag(tag);
                    }
                  },
                  visualDensity: VisualDensity.compact,
                ),
              );
            }),
          ],
        ),
      ),
    );
  }
}

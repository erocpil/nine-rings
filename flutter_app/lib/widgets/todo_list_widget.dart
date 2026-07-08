import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';

const _uuid = Uuid();

class TodoListWidget extends StatefulWidget {
  final Map<String, dynamic> dailyPage;
  final Function(List<dynamic> todos) onUpdate;
  final Function(bool enabled) onToggleCarryover;

  const TodoListWidget({
    super.key,
    required this.dailyPage,
    required this.onUpdate,
    required this.onToggleCarryover,
  });

  @override
  State<TodoListWidget> createState() => _TodoListWidgetState();
}

class _TodoListWidgetState extends State<TodoListWidget> {
  late List<dynamic> _todos;
  late bool _carryover;

  @override
  void initState() {
    super.initState();
    _todos = List.from(widget.dailyPage['todos'] as List? ?? []);
    _carryover = widget.dailyPage['todo_carryover'] == true;
  }

  @override
  void didUpdateWidget(TodoListWidget oldWidget) {
    super.didUpdateWidget(oldWidget);
    _todos = List.from(widget.dailyPage['todos'] as List? ?? []);
    _carryover = widget.dailyPage['todo_carryover'] == true;
  }

  void _toggleTodo(int index) {
    final todo = Map<String, dynamic>.from(_todos[index]);
    todo['done'] = todo['done'] == 1 || todo['done'] == true ? 0 : 1;
    _todos[index] = todo;
    setState(() {});
    widget.onUpdate(_todos);
  }

  void _deleteTodo(int index) {
    _todos.removeAt(index);
    setState(() {});
    widget.onUpdate(_todos);
  }

  void _addTodo() {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('添加待办'),
        content: TextField(
          controller: controller,
          autofocus: true,
          decoration: const InputDecoration(
            hintText: '待办内容',
            border: OutlineInputBorder(),
          ),
          onSubmitted: (value) {
            if (value.trim().isNotEmpty) {
              _todos.add({
                'id': _uuid.v4(),
                'text': value.trim(),
                'done': 0,
                'order': _todos.length,
                'tags': [],
              });
              widget.onUpdate(_todos);
            }
            Navigator.pop(ctx);
          },
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('取消')),
          TextButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.isNotEmpty) {
                _todos.add({
                  'id': _uuid.v4(),
                  'text': value,
                  'done': 0,
                  'order': _todos.length,
                  'tags': [],
                });
                widget.onUpdate(_todos);
              }
              Navigator.pop(ctx);
            },
            child: const Text('添加'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Card(
      margin: const EdgeInsets.all(8),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header
            Row(
              children: [
                Icon(Icons.checklist, size: 20, color: theme.colorScheme.primary),
                const SizedBox(width: 8),
                Text('今日待办', style: theme.textTheme.titleMedium),
                const Spacer(),
                // Carryover toggle
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('跨日继承', style: theme.textTheme.labelSmall),
                    Switch(
                      value: _carryover,
                      onChanged: (v) {
                        setState(() => _carryover = v);
                        widget.onToggleCarryover(v);
                      },
                      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ],
                ),
                IconButton(
                  icon: const Icon(Icons.add_circle_outline, size: 20),
                  onPressed: _addTodo,
                  constraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  padding: EdgeInsets.zero,
                ),
              ],
            ),

            // Todo list
            if (_todos.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text('暂无待办', style: TextStyle(color: theme.disabledColor, fontSize: 13)),
              )
            else
              ...List.generate(_todos.length, (i) {
                final todo = _todos[i];
                final isDone = todo['done'] == 1 || todo['done'] == true;
                return ListTile(
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  leading: Checkbox(
                    value: isDone,
                    onChanged: (_) => _toggleTodo(i),
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  title: Text(
                    todo['text'] as String? ?? '',
                    style: TextStyle(
                      decoration: isDone ? TextDecoration.lineThrough : null,
                      color: isDone ? theme.disabledColor : null,
                    ),
                  ),
                  trailing: IconButton(
                    icon: const Icon(Icons.close, size: 16),
                    onPressed: () => _deleteTodo(i),
                    constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                    padding: EdgeInsets.zero,
                  ),
                );
              }),
          ],
        ),
      ),
    );
  }
}

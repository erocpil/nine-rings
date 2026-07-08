import 'todo.dart';

class DailyPage {
  final String date; // "2026-07-08", PK
  List<Todo> todos;
  bool todoCarryover;
  String updatedAt;

  DailyPage({
    required this.date,
    List<Todo>? todos,
    bool? todoCarryover,
    String? updatedAt,
  })  : todos = todos ?? [],
        todoCarryover = todoCarryover ?? false,
        updatedAt = updatedAt ?? DateTime.now().toUtc().toIso8601String();

  Map<String, dynamic> toJson() => {
        'date': date,
        'todos': todos.map((t) => t.toJson()).toList(),
        'todo_carryover': todoCarryover ? 1 : 0,
        'updated_at': updatedAt,
      };

  factory DailyPage.fromJson(Map<String, dynamic> json) {
    final todosRaw = json['todos'];
    return DailyPage(
      date: json['date'] as String,
      todos: todosRaw != null
          ? (todosRaw as List).map((e) => Todo.fromJson(e as Map<String, dynamic>)).toList()
          : null,
      todoCarryover: json['todo_carryover'] == 1 || json['todo_carryover'] == true,
      updatedAt: json['updated_at'] as String?,
    );
  }

  DailyPage copyWith({
    List<Todo>? todos,
    bool? todoCarryover,
  }) =>
      DailyPage(
        date: date,
        todos: todos ?? List.from(this.todos),
        todoCarryover: todoCarryover ?? this.todoCarryover,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
      );

  @override
  String toString() => 'DailyPage(date=$date, todos=${todos.length})';
}

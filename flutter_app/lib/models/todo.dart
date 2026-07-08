import 'package:uuid/uuid.dart';

const _uuid = Uuid();

class Todo {
  final String id;
  String text;
  bool done;
  int order;
  List<String> tags;

  Todo({
    String? id,
    required this.text,
    bool? done,
    int? order,
    List<String>? tags,
  })  : id = id ?? _uuid.v4(),
        done = done ?? false,
        order = order ?? 0,
        tags = tags ?? [];

  Map<String, dynamic> toJson() => {
        'id': id,
        'text': text,
        'done': done ? 1 : 0,
        'order': order,
        'tags': tags,
      };

  factory Todo.fromJson(Map<String, dynamic> json) => Todo(
        id: json['id'] as String?,
        text: json['text'] as String,
        done: json['done'] == 1 || json['done'] == true,
        order: json['order'] as int?,
        tags: json['tags'] != null
            ? (json['tags'] as List).map((e) => e.toString()).toList()
            : null,
      );

  Todo copyWith({
    String? text,
    bool? done,
    int? order,
    List<String>? tags,
  }) =>
      Todo(
        id: id,
        text: text ?? this.text,
        done: done ?? this.done,
        order: order ?? this.order,
        tags: tags ?? List.from(this.tags),
      );

  @override
  String toString() => 'Todo(id=$id, text=$text, done=$done)';
}

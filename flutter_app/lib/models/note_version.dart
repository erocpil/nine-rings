class NoteVersion {
  final String id;
  final String noteId;
  final String title;
  final String content; // Delta JSON
  final List<String> tags;
  final int order;
  final String createdAt; // snapshot timestamp

  NoteVersion({
    required this.id,
    required this.noteId,
    required this.title,
    required this.content,
    required this.tags,
    required this.order,
    required this.createdAt,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'note_id': noteId,
        'title': title,
        'content': content,
        'tags': tags,
        'order': order,
        'created_at': createdAt,
      };

  factory NoteVersion.fromJson(Map<String, dynamic> json) => NoteVersion(
        id: json['id'] as String,
        noteId: json['note_id'] as String,
        title: json['title'] as String? ?? '',
        content: json['content'] as String? ?? '[]',
        tags: json['tags'] != null
            ? (json['tags'] as List).map((e) => e.toString()).toList()
            : [],
        order: json['order'] as int? ?? 0,
        createdAt: json['created_at'] as String,
      );

  @override
  String toString() => 'NoteVersion(id=$id, noteId=$noteId, createdAt=$createdAt)';
}

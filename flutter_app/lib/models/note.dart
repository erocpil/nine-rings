import 'dart:convert';
import 'package:uuid/uuid.dart';

const _uuid = Uuid();

class Note {
  final String id;
  final String date; // "2026-07-08"
  String? title;
  String content; // Delta JSON string (TipTap / flutter_quill compatible)
  List<String> tags;
  bool pinned;
  int order;
  final String createdAt;
  String updatedAt;
  String? deletedAt;

  Note({
    String? id,
    required this.date,
    this.title,
    String? content,
    List<String>? tags,
    bool? pinned,
    int? order,
    String? createdAt,
    String? updatedAt,
    this.deletedAt,
  })  : id = id ?? _uuid.v4(),
        content = content ?? '[]',
        tags = tags ?? [],
        pinned = pinned ?? false,
        order = order ?? 0,
        createdAt = createdAt ?? DateTime.now().toUtc().toIso8601String(),
        updatedAt = updatedAt ?? DateTime.now().toUtc().toIso8601String();

  Map<String, dynamic> toJson() => {
        'id': id,
        'date': date,
        'title': title,
        'content': content,
        'tags': tags,
        'pinned': pinned ? 1 : 0,
        'order': order,
        'created_at': createdAt,
        'updated_at': updatedAt,
        'deleted_at': deletedAt,
      };

  factory Note.fromJson(Map<String, dynamic> json) => Note(
        id: json['id'] as String?,
        date: json['date'] as String,
        title: json['title'] as String?,
        content: json['content'] as String?,
        tags: json['tags'] != null
            ? (json['tags'] as List).map((e) => e.toString()).toList()
            : null,
        pinned: json['pinned'] == 1 || json['pinned'] == true,
        order: json['order'] as int?,
        createdAt: json['created_at'] as String?,
        updatedAt: json['updated_at'] as String?,
        deletedAt: json['deleted_at'] as String?,
      );

  /// Extract plain text from Delta JSON content for search_text column
  String get plainText {
    try {
      final delta = jsonDecode(content);
      if (delta is! List) return '';
      return delta
          .where((op) => op is Map && op['insert'] is String)
          .map((op) => op['insert'] as String)
          .join()
          .trim();
    } catch (_) {
      return '';
    }
  }

  Note copyWith({
    String? title,
    String? content,
    List<String>? tags,
    bool? pinned,
    int? order,
    String? deletedAt,
  }) =>
      Note(
        id: id,
        date: date,
        title: title ?? this.title,
        content: content ?? this.content,
        tags: tags ?? List.from(this.tags),
        pinned: pinned ?? this.pinned,
        order: order ?? this.order,
        createdAt: createdAt,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        deletedAt: deletedAt ?? this.deletedAt,
      );

  Note copyWithUpdated({String? deletedAt}) => Note(
        id: id,
        date: date,
        title: title,
        content: content,
        tags: List.from(tags),
        pinned: pinned,
        order: order,
        createdAt: createdAt,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        deletedAt: deletedAt ?? this.deletedAt,
      );

  @override
  String toString() => 'Note(id=$id, date=$date, title=$title)';
}

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
  int sortOrder;
  final String createdAt;
  String updatedAt;
  String? deletedAt;

  // ── 文档管理系统（v2）──
  String? storagePath; // P.A.R.A. 目录路径, e.g. "projects/nine-rings"
  String? docType;     // Diátaxis 类型: explanation|how-to|reference|tutorial
  List<String>? concepts; // Zettelkasten 概念标签
  List<String>? linkedDocIds; // 关联文档 ID 列表
  bool readonly;

  Note({
    String? id,
    required this.date,
    this.title,
    String? content,
    List<String>? tags,
    bool? pinned,
    int? sortOrder,
    String? createdAt,
    String? updatedAt,
    this.deletedAt,
    this.storagePath,
    this.docType,
    List<String>? concepts,
    List<String>? linkedDocIds,
    bool? readonly,
  })  : id = id ?? _uuid.v4(),
        content = content ?? '[]',
        tags = tags ?? [],
        pinned = pinned ?? false,
        sortOrder = sortOrder ?? 0,
        createdAt = createdAt ?? DateTime.now().toUtc().toIso8601String(),
        updatedAt = updatedAt ?? DateTime.now().toUtc().toIso8601String(),
        concepts = concepts,
        linkedDocIds = linkedDocIds,
        readonly = readonly ?? false;

  Map<String, dynamic> toJson() => {
        'id': id,
        'date': date,
        'title': title,
        'content': content,
        'tags': tags,
        'pinned': pinned ? 1 : 0,
        'sort_order': sortOrder,
        'created_at': createdAt,
        'updated_at': updatedAt,
        'deleted_at': deletedAt,
        'storage_path': storagePath,
        'doc_type': docType,
        'concepts': concepts != null ? jsonEncode(concepts) : null,
        'linked_doc_ids': linkedDocIds != null ? jsonEncode(linkedDocIds) : null,
        'readonly': readonly ? 1 : 0,
      };

  factory Note.fromJson(Map<String, dynamic> json) => Note(
        id: json['id'] as String?,
        date: json['date'] as String,
        title: json['title'] as String?,
        content: json['content'] as String?,
        tags: _parseTags(json['tags']),
        pinned: json['pinned'] == 1 || json['pinned'] == true,
        sortOrder: json['sort_order'] as int?,
        createdAt: json['created_at'] as String?,
        updatedAt: json['updated_at'] as String?,
        deletedAt: json['deleted_at'] as String?,
        storagePath: json['storage_path'] as String?,
        docType: json['doc_type'] as String?,
        concepts: _parseStringList(json['concepts']),
        linkedDocIds: _parseStringList(json['linked_doc_ids']),
        readonly: json['readonly'] == 1 || json['readonly'] == true,
      );

  static List<String>? _parseStringList(dynamic val) {
    if (val == null) return null;
    if (val is List) return val.map((e) => e.toString()).toList();
    if (val is String) {
      try {
        final parsed = jsonDecode(val);
        if (parsed is List) return parsed.map((e) => e.toString()).toList();
      } catch (_) {}
    }
    return null;
  }

  static List<String> _parseTags(dynamic val) {
    if (val == null) return [];
    if (val is List) return val.map((e) => e.toString()).toList();
    if (val is String) {
      try {
        final parsed = jsonDecode(val);
        if (parsed is List) return parsed.map((e) => e.toString()).toList();
      } catch (_) {}
    }
    return [];
  }

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
    int? sortOrder,
    String? deletedAt,
    String? storagePath,
    String? docType,
    List<String>? concepts,
    List<String>? linkedDocIds,
    bool? readonly,
  }) =>
      Note(
        id: id,
        date: date,
        title: title ?? this.title,
        content: content ?? this.content,
        tags: tags ?? List.from(this.tags),
        pinned: pinned ?? this.pinned,
        sortOrder: sortOrder ?? this.sortOrder,
        createdAt: createdAt,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        deletedAt: deletedAt ?? this.deletedAt,
        storagePath: storagePath ?? this.storagePath,
        docType: docType ?? this.docType,
        concepts: concepts ?? (this.concepts != null ? List.from(this.concepts!) : null),
        linkedDocIds: linkedDocIds ?? (this.linkedDocIds != null ? List.from(this.linkedDocIds!) : null),
        readonly: readonly ?? this.readonly,
      );

  Note copyWithUpdated({String? deletedAt}) => Note(
        id: id,
        date: date,
        title: title,
        content: content,
        tags: List.from(tags),
        pinned: pinned,
        sortOrder: sortOrder,
        createdAt: createdAt,
        updatedAt: DateTime.now().toUtc().toIso8601String(),
        deletedAt: deletedAt ?? this.deletedAt,
        storagePath: storagePath,
        docType: docType,
        concepts: concepts != null ? List.from(concepts!) : null,
        linkedDocIds: linkedDocIds != null ? List.from(linkedDocIds!) : null,
        readonly: readonly,
      );

  @override
  String toString() => 'Note(id=$id, date=$date, title=$title, storagePath=$storagePath)';
}

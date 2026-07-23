import 'dart:convert';
import 'package:uuid/uuid.dart';
import '../database/database_helper.dart';

const _uuid = Uuid();

class Template {
  final String id;
  String name;
  String description;
  final bool isBuiltin;
  String? titleTemplate;
  List<String> tags;
  String? storagePath;
  String? docType;
  List<String> concepts;
  bool pinned;
  int sortOrder;
  final String createdAt;
  String updatedAt;

  Template({
    String? id,
    required this.name,
    this.description = '',
    this.isBuiltin = false,
    this.titleTemplate,
    List<String>? tags,
    this.storagePath,
    this.docType,
    List<String>? concepts,
    this.pinned = false,
    this.sortOrder = 0,
    String? createdAt,
    String? updatedAt,
  })  : id = id ?? _uuid.v4(),
        tags = tags ?? [],
        concepts = concepts ?? [],
        createdAt = createdAt ?? DateTime.now().toUtc().toIso8601String(),
        updatedAt = updatedAt ?? DateTime.now().toUtc().toIso8601String();

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'description': description,
        'is_builtin': isBuiltin ? 1 : 0,
        'title_template': titleTemplate,
        'tags': jsonEncode(tags),
        'storage_path': storagePath,
        'doc_type': docType,
        'concepts': jsonEncode(concepts),
        'pinned': pinned ? 1 : 0,
        'sort_order': sortOrder,
        'created_at': createdAt,
        'updated_at': updatedAt,
      };

  factory Template.fromJson(Map<String, dynamic> json) => Template(
        id: json['id'] as String?,
        name: json['name'] as String,
        description: json['description'] as String? ?? '',
        isBuiltin: json['is_builtin'] == 1 || json['is_builtin'] == true,
        titleTemplate: json['title_template'] as String?,
        tags: _parseStringList(json['tags']),
        storagePath: json['storage_path'] as String?,
        docType: json['doc_type'] as String?,
        concepts: _parseStringList(json['concepts']),
        pinned: json['pinned'] == 1 || json['pinned'] == true,
        sortOrder: json['sort_order'] as int? ?? 0,
        createdAt: json['created_at'] as String,
        updatedAt: json['updated_at'] as String,
      );

  static List<String> _parseStringList(dynamic val) {
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
}

class TemplateService {
  final DatabaseHelper _db = DatabaseHelper.instance;

  static const _builtinTemplates = [
    {
      'id': 'builtin-blank',
      'name': '空白笔记',
      'description': '无预设元数据的空白笔记',
      'tags': <String>[],
      'storage_path': null,
      'doc_type': null,
      'concepts': <String>[],
      'pinned': false,
      'sort_order': 0,
    },
    {
      'id': 'builtin-idea',
      'name': '灵感记录',
      'description': '随手记录灵感，默认置顶',
      'tags': ['灵感'],
      'storage_path': null,
      'doc_type': 'note',
      'concepts': <String>[],
      'pinned': true,
      'sort_order': 1,
    },
    {
      'id': 'builtin-todo',
      'name': '待办清单',
      'description': '待办事项模板',
      'tags': ['待办'],
      'storage_path': null,
      'doc_type': 'note',
      'concepts': <String>[],
      'pinned': false,
      'sort_order': 2,
    },
    {
      'id': 'builtin-reading',
      'name': '读书笔记',
      'description': '阅读笔记，预设阅读标签和知识概念',
      'tags': ['阅读'],
      'storage_path': 'areas/reading',
      'doc_type': 'note',
      'concepts': ['读书笔记'],
      'pinned': false,
      'sort_order': 3,
    },
    {
      'id': 'builtin-knowledge',
      'name': '知识卡片',
      'description': '独立知识条目',
      'tags': ['知识'],
      'storage_path': 'references/knowledge',
      'doc_type': 'card',
      'concepts': ['知识卡片'],
      'pinned': false,
      'sort_order': 4,
    },
    {
      'id': 'builtin-meeting',
      'name': '会议纪要',
      'description': '会议记录模板',
      'tags': ['会议'],
      'storage_path': 'projects/meetings',
      'doc_type': 'meeting',
      'concepts': ['会议纪要'],
      'pinned': false,
      'sort_order': 5,
    },
    {
      'id': 'builtin-project',
      'name': '项目日志',
      'description': '项目开发日志',
      'tags': ['项目'],
      'storage_path': 'projects/logs',
      'doc_type': 'log',
      'concepts': ['项目日志'],
      'pinned': false,
      'sort_order': 6,
    },
    {
      'id': 'builtin-weekly',
      'name': '项目周报',
      'description': '每周项目工作总结',
      'tags': ['周报'],
      'storage_path': 'areas/weekly',
      'doc_type': 'report',
      'concepts': ['周报'],
      'pinned': false,
      'sort_order': 7,
    },
  ];

  Future<List<Template>> listTemplates() async {
    final rows = await _db.database.query(
      'templates',
      orderBy: 'sort_order ASC',
    );
    return rows.map((r) => Template.fromJson(r)).toList();
  }

  Future<void> seedBuiltinTemplates() async {
    final ts = DateTime.now().toUtc().toIso8601String();
    for (final bt in _builtinTemplates) {
      final existing = await _db.database.query(
        'templates',
        columns: ['id', 'sort_order'],
        where: 'id = ?',
        whereArgs: [bt['id']],
        limit: 1,
      );
      if (existing.isNotEmpty) {
        // Update sort_order if changed
        if (existing.first['sort_order'] != bt['sort_order']) {
          await _db.database.update(
            'templates',
            {'sort_order': bt['sort_order'], 'updated_at': ts},
            where: 'id = ?',
            whereArgs: [bt['id']],
          );
        }
      } else {
        await _db.database.insert('templates', {
          'id': bt['id'],
          'name': bt['name'],
          'description': bt['description'],
          'is_builtin': 1,
          'title_template': null,
          'tags': jsonEncode(bt['tags']),
          'storage_path': bt['storage_path'],
          'doc_type': bt['doc_type'],
          'concepts': jsonEncode(bt['concepts']),
          'pinned': (bt['pinned'] as bool) ? 1 : 0,
          'sort_order': bt['sort_order'],
          'created_at': ts,
          'updated_at': ts,
        });
      }
    }
  }

  Future<Template> createTemplate({
    required String name,
    String description = '',
    String? titleTemplate,
    List<String> tags = const [],
    String? storagePath,
    String? docType,
    List<String> concepts = const [],
    bool pinned = false,
  }) async {
    final ts = DateTime.now().toUtc().toIso8601String();
    final t = Template(
      name: name,
      description: description,
      titleTemplate: titleTemplate,
      tags: tags,
      storagePath: storagePath,
      docType: docType,
      concepts: concepts,
      pinned: pinned,
      createdAt: ts,
      updatedAt: ts,
    );
    await _db.database.insert('templates', t.toJson());
    return t;
  }

  Future<void> deleteTemplate(String id) async {
    await _db.database.delete(
      'templates',
      where: 'id = ? AND is_builtin = 0',
      whereArgs: [id],
    );
  }
}

import 'package:flutter/foundation.dart';
import '../models/note.dart';
import '../models/note_version.dart';
import '../services/note_service.dart';

class NoteProvider extends ChangeNotifier {
  final NoteService _service = NoteService();

  // State
  final Map<String, List<Note>> _notesByDate = {};
  List<String> _recentDates = [];
  List<Note> _trashNotes = [];
  List<Note> _searchResults = [];
  List<String> _allTags = [];
  List<Note> _tagFilteredNotes = [];
  List<NoteVersion> _versions = [];
  Map<String, dynamic>? _currentDailyPage;
  bool _loading = false;
  String? _error;

  // ── Phase 3: 文档树、属性面板、概念聚合 ──
  Map<String, List<Note>> _pathTree = {};
  List<Note> _docsByPath = [];
  List<String> _allConcepts = [];
  List<Note> _backlinks = [];

  // Getters
  Map<String, List<Note>> get notesByDate => _notesByDate;
  List<String> get recentDates => _recentDates;
  List<Note> get trashNotes => _trashNotes;
  List<Note> get searchResults => _searchResults;
  List<String> get allTags => _allTags;
  List<Note> get tagFilteredNotes => _tagFilteredNotes;
  List<NoteVersion> get versions => _versions;
  Map<String, dynamic>? get currentDailyPage => _currentDailyPage;
  bool get loading => _loading;
  String? get error => _error;

  // Phase 3 getters
  Map<String, List<Note>> get pathTree => _pathTree;
  List<Note> get docsByPath => _docsByPath;
  List<String> get allConcepts => _allConcepts;
  List<Note> get backlinks => _backlinks;

  void _setLoading(bool v) {
    _loading = v;
    notifyListeners();
  }

  void _setError(String? e) {
    _error = e;
    notifyListeners();
  }

  // ── Notes by date ──

  Future<void> loadNotesByDate(String date) async {
    _setLoading(true);
    try {
      final notes = await _service.getNotesByDate(date);
      _notesByDate[date] = notes;
      _setError(null);
    } catch (e) {
      _setError('加载笔记失败: $e');
    }
    _setLoading(false);
  }

  Future<void> loadRecentDates() async {
    try {
      _recentDates = await _service.getRecentDates();
      notifyListeners();
    } catch (e) {
      _setError('加载日期列表失败: $e');
    }
  }

  // ── CRUD ──

  Future<Note?> createNote({
    required String date,
    String? title,
    String? content,
    List<String>? tags,
    String? storagePath,
    String? docType,
    List<String>? concepts,
    List<String>? linkedDocIds,
    bool? readonly,
  }) async {
    _setLoading(true);
    try {
      final note = await _service.createNote(
        date: date,
        title: title,
        content: content,
        tags: tags,
        storagePath: storagePath,
        docType: docType,
        concepts: concepts,
        linkedDocIds: linkedDocIds,
        readonly: readonly,
      );
      await loadNotesByDate(date);
      await loadRecentDates();
      _setError(null);
      return note;
    } catch (e) {
      _setError('创建笔记失败: $e');
      return null;
    } finally {
      _setLoading(false);
    }
  }

  Future<Note?> updateNote(Note note, {
    String? title,
    String? content,
    List<String>? tags,
    bool? pinned,
    int? sortOrder,
    String? storagePath,
    String? docType,
    List<String>? concepts,
    List<String>? linkedDocIds,
    bool? readonly,
  }) async {
    _setLoading(true);
    try {
      final updated = await _service.updateNote(
        note,
        title: title,
        content: content,
        tags: tags,
        pinned: pinned,
        sortOrder: sortOrder,
        storagePath: storagePath,
        docType: docType,
        concepts: concepts,
        linkedDocIds: linkedDocIds,
        readonly: readonly,
      );
      await loadNotesByDate(note.date);
      _setError(null);
      return updated;
    } catch (e) {
      _setError('更新笔记失败: $e');
      return null;
    } finally {
      _setLoading(false);
    }
  }

  Future<void> deleteNote(String id, String date) async {
    try {
      await _service.deleteNote(id);
      await loadNotesByDate(date);
      notifyListeners();
    } catch (e) {
      _setError('删除笔记失败: $e');
    }
  }

  Future<void> restoreNote(String id, String date) async {
    try {
      await _service.restoreNote(id);
      await loadTrash();
      await loadNotesByDate(date);
    } catch (e) {
      _setError('恢复笔记失败: $e');
    }
  }

  // ── Trash ──

  Future<void> loadTrash() async {
    try {
      _trashNotes = await _service.getTrashNotes();
      notifyListeners();
    } catch (e) {
      _setError('加载回收站失败: $e');
    }
  }

  Future<void> permanentlyDelete(String id) async {
    try {
      await _service.permanentlyDeleteNote(id);
      await loadTrash();
    } catch (e) {
      _setError('永久删除失败: $e');
    }
  }

  Future<void> emptyTrash() async {
    try {
      await _service.emptyTrash();
      await loadTrash();
    } catch (e) {
      _setError('清空回收站失败: $e');
    }
  }

  // ── Search ──

  Future<void> search(String query) async {
    try {
      _searchResults = await _service.search(query);
      notifyListeners();
    } catch (e) {
      _setError('搜索失败: $e');
    }
  }

  void clearSearch() {
    _searchResults = [];
    notifyListeners();
  }

  // ── Tags ──

  Future<void> loadAllTags() async {
    try {
      _allTags = await _service.getAllTags();
      notifyListeners();
    } catch (e) {
      _setError('加载标签失败: $e');
    }
  }

  Future<void> filterByTag(String tag) async {
    _setLoading(true);
    try {
      _tagFilteredNotes = await _service.getNotesByTag(tag);
      _setError(null);
    } catch (e) {
      _setError('标签筛选失败: $e');
    }
    _setLoading(false);
  }

  void clearTagFilter() {
    _tagFilteredNotes = [];
    notifyListeners();
  }

  // ── Export / Import ──

  Future<String> exportAll() => _service.exportAll();

  Future<({int notesImported, int pagesImported})> importBundle(String jsonStr) async {
    final result = await _service.importBundle(jsonStr);
    await loadRecentDates();
    notifyListeners();
    return result;
  }

  // ── Version History ──

  Future<void> loadVersions(String noteId) async {
    try {
      _versions = await _service.getVersions(noteId);
      notifyListeners();
    } catch (e) {
      _setError('加载版本历史失败: $e');
    }
  }

  Future<Note?> restoreVersion(String noteId, String versionId, String date) async {
    try {
      final restored = await _service.restoreVersion(noteId, versionId);
      if (restored != null) {
        await loadNotesByDate(date);
      }
      return restored;
    } catch (e) {
      _setError('恢复版本失败: $e');
      return null;
    }
  }

  // ── Daily Page ──

  Future<void> loadDailyPage(String date) async {
    try {
      _currentDailyPage = await _service.getOrCreateDailyPage(date);
      notifyListeners();
    } catch (e) {
      _setError('加载每日页失败: $e');
    }
  }

  Future<void> updateTodos(String date, List<dynamic> todos) async {
    try {
      await _service.updateDailyPageTodos(date, todos);
      await loadDailyPage(date);
    } catch (e) {
      _setError('更新待办失败: $e');
    }
  }

  Future<void> setTodoCarryover(String date, bool enabled) async {
    try {
      await _service.setTodoCarryover(date, enabled);
      await loadDailyPage(date);
    } catch (e) {
      _setError('更新待办继承失败: $e');
    }
  }

  // ── Phase 3: 文档树、属性面板、概念聚合 ──

  Future<void> loadPathTree() async {
    try {
      _pathTree = await _service.getPathTree();
      notifyListeners();
    } catch (e) {
      _setError('加载路径树失败: $e');
    }
  }

  Future<void> loadDocsByPath(String pathPrefix) async {
    _setLoading(true);
    try {
      _docsByPath = await _service.getNotesByPath(pathPrefix);
      _setError(null);
    } catch (e) {
      _setError('加载路径笔记失败: $e');
    }
    _setLoading(false);
  }

  Future<void> loadAllConcepts() async {
    try {
      _allConcepts = await _service.getAllConcepts();
      notifyListeners();
    } catch (e) {
      _setError('加载概念列表失败: $e');
    }
  }

  Future<List<Note>> searchDocs({
    String? text,
    String? storagePath,
    String? docType,
    String? concept,
  }) async {
    try {
      final results = await _service.searchDocs(
        text: text,
        storagePath: storagePath,
        docType: docType,
        concept: concept,
      );
      return results;
    } catch (e) {
      _setError('文档搜索失败: $e');
      return [];
    }
  }

  Future<Note?> loadNote(String id) async {
    try {
      return await _service.getNoteById(id);
    } catch (e) {
      _setError('加载笔记失败: $e');
      return null;
    }
  }

  Future<void> loadBacklinks(String noteId) async {
    try {
      _backlinks = await _service.getBacklinks(noteId);
      notifyListeners();
    } catch (e) {
      _setError('加载反向链接失败: $e');
    }
  }

  Future<int> renameFolder(String oldPath, String newPath) async {
    try {
      final count = await _service.renameFolder(oldPath, newPath);
      await loadPathTree();
      return count;
    } catch (e) {
      _setError('重命名文件夹失败: $e');
      return 0;
    }
  }

  // ── Markdown ──

  String deltaToMarkdown(String deltaJson) => _service.deltaToMarkdown(deltaJson);

  String mdToDelta(String mdText) => _service.mdToDelta(mdText);

  String extractTitle(String mdText, String fallback) => _service.extractTitle(mdText, fallback);
}

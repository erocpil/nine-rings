/// github_sync.dart — GitHub 版本化备份同步服务
///
/// 与 Web 端 src/lib/sync/github.ts 实现对齐。
///
/// 数据流：
///   Push: SQLite → 序列化 JSON → PUT /repos/{owner}/{repo}/contents/
///   Pull: GET → 下载 JSON → 覆盖 SQLite
///
/// 版本化策略：
///   1. 数据文件：{path}-{version}.json（不可变，每次创建新文件）
///   2. 指针文件：{path}-latest（纯文本，内容为最新版本号）
///
/// 认证：GitHub Personal Access Token（classic 或 fine-grained，需 repo 权限）

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import '../models/note.dart';

// ── 类型 ──

class SyncConfig {
  String token;
  String owner;
  String repo;
  String path;
  String? lastSyncAt;
  String? lastPushVersion;
  String? lastPullVersion;

  SyncConfig({
    this.token = '',
    this.owner = '',
    this.repo = '',
    this.path = 'nine-rings-backup.json',
    this.lastSyncAt,
    this.lastPushVersion,
    this.lastPullVersion,
  });

  factory SyncConfig.fromJson(Map<String, dynamic> json) => SyncConfig(
        token: json['token'] as String? ?? '',
        owner: json['owner'] as String? ?? '',
        repo: json['repo'] as String? ?? '',
        path: json['path'] as String? ?? 'nine-rings-backup.json',
        lastSyncAt: json['lastSyncAt'] as String?,
        lastPushVersion: json['lastPushVersion'] as String?,
        lastPullVersion: json['lastPullVersion'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'token': token,
        'owner': owner,
        'repo': repo,
        'path': path,
        'lastSyncAt': lastSyncAt,
        'lastPushVersion': lastPushVersion,
        'lastPullVersion': lastPullVersion,
      };

  bool get isConfigured => token.isNotEmpty && owner.isNotEmpty && repo.isNotEmpty;
}

class SyncStatus {
  final bool ok;
  final String message;

  const SyncStatus({required this.ok, required this.message});
}

// ── 配置持久化 ──

// 存储键：与 Web 端 localStorage 对齐
const _storageKey = 'nr:github-sync';

SyncConfig? _cachedConfig;

SyncConfig _defaultConfig() => SyncConfig();

String _configFilePath() {
  // 存放在应用数据目录，与数据库同目录
  final dbPath = Directory.current.path;
  return '$dbPath/$_storageKey.json';
}

SyncConfig loadSyncConfig() {
  if (_cachedConfig != null) return _cachedConfig!;
  try {
    final file = File(_configFilePath());
    if (file.existsSync()) {
      final raw = file.readAsStringSync();
      _cachedConfig = SyncConfig.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      return _cachedConfig!;
    }
  } catch (_) {
    /* ignore */
  }
  _cachedConfig = _defaultConfig();
  return _cachedConfig!;
}

void saveSyncConfig(SyncConfig config) {
  _cachedConfig = config;
  try {
    final file = File(_configFilePath());
    file.writeAsStringSync(jsonEncode(config.toJson()));
  } catch (_) {
    /* ignore */
  }
}

// ── API 调用 ──

Map<String, String> _authHeader(String token) => {
      'Authorization': 'Bearer $token',
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };

Future<HttpClientResponse> _apiRequest({
  required String method,
  required String url,
  required Map<String, String> headers,
  String? body,
}) async {
  final client = HttpClient();
  try {
    final uri = Uri.parse(url);
    final request = method == 'GET'
        ? await client.getUrl(uri)
        : method == 'PUT'
            ? await client.putUrl(uri)
            : await client.getUrl(uri); // fallback

    headers.forEach((k, v) => request.headers.set(k, v));

    if (body != null) {
      request.headers.set('Content-Type', 'application/json');
      request.write(body);
    }

    final response = await request.close();
    return response;
  } catch (e) {
    client.close();
    rethrow;
  }
}

/// 获取远端文件内容 + SHA
Future<({String content, String sha})?> fetchRemote(
  String token,
  String owner,
  String repo,
  String path,
) async {
  final url =
      'https://api.github.com/repos/$owner/$repo/contents/${Uri.encodeComponent(path)}';
  final response =
      await _apiRequest(method: 'GET', url: url, headers: _authHeader(token));

  final body = await response.transform(utf8.decoder).join();

  if (response.statusCode == 404) return null;

  if (response.statusCode != 200) {
    throw Exception('GitHub API ${response.statusCode}: ${body.substring(0, body.length.clamp(0, 200))}');
  }

  final data = jsonDecode(body) as Map<String, dynamic>;
  if (data['sha'] == null) {
    throw Exception('GitHub API 返回数据缺少 sha 字段');
  }

  // 文件 >1MB 时不返回 base64 content，用 Git Blobs API
  final contentBase64 = data['content'] as String?;
  final hasContent = contentBase64 != null &&
      contentBase64.isNotEmpty &&
      data['encoding'] == 'base64';

  String decodedContent;

  if (hasContent) {
    decodedContent = utf8.decode(base64Decode(contentBase64));
  } else {
    // 大文件：用 Git Blobs API
    final blobUrl =
        'https://api.github.com/repos/$owner/$repo/git/blobs/${data['sha']}';
    final blobResponse =
        await _apiRequest(method: 'GET', url: blobUrl, headers: _authHeader(token));
    final blobBody = await blobResponse.transform(utf8.decoder).join();
    if (blobResponse.statusCode != 200) {
      throw Exception('Git Blobs API ${blobResponse.statusCode}');
    }
    final blobData = jsonDecode(blobBody) as Map<String, dynamic>;
    if (blobData['content'] == null || blobData['encoding'] != 'base64') {
      throw Exception('Git Blobs API 返回非 base64 内容');
    }
    decodedContent = utf8.decode(base64Decode(blobData['content'] as String));
  }

  return (content: decodedContent, sha: data['sha'] as String);
}

/// 上传/更新远端文件
Future<String> putRemote(
  String token,
  String owner,
  String repo,
  String path,
  String content,
  String? sha,
  String message,
) async {
  final url =
      'https://api.github.com/repos/$owner/$repo/contents/${Uri.encodeComponent(path)}';
  final body = <String, dynamic>{
    'message': message,
    'content': base64Encode(utf8.encode(content)),
  };
  if (sha != null) body['sha'] = sha;

  final response = await _apiRequest(
    method: 'PUT',
    url: url,
    headers: _authHeader(token),
    body: jsonEncode(body),
  );

  final responseBody = await response.transform(utf8.decoder).join();

  if (response.statusCode != 200 && response.statusCode != 201) {
    throw Exception(
        'GitHub PUT ${response.statusCode}: ${responseBody.substring(0, responseBody.length.clamp(0, 200))}');
  }

  final data = jsonDecode(responseBody) as Map<String, dynamic>;
  final contentObj = data['content'] as Map<String, dynamic>?;
  if (contentObj == null || contentObj['sha'] == null) {
    throw Exception('GitHub PUT 返回数据缺少 content.sha');
  }

  return contentObj['sha'] as String;
}

// ── 版本化路径工具 ──

/// 从基础路径推导时间戳数据文件路径 "base-20260715T123000.json"
String _versionedPath(String basePath, String version) {
  final dot = basePath.lastIndexOf('.');
  if (dot == -1) return '$basePath-$version';
  return '${basePath.substring(0, dot)}-$version${basePath.substring(dot)}';
}

/// 从基础路径推导 latest 指针文件路径 "base-latest"
String _latestPath(String basePath) {
  final dot = basePath.lastIndexOf('.');
  if (dot == -1) return '$basePath-latest';
  return '${basePath.substring(0, dot)}-latest';
}

// ── 数据导出/导入 ──

/// 导出全量数据为 JSON 字符串（与 Web 端格式兼容）
typedef ExportFn = Future<String> Function();
/// 从 JSON 字符串导入全量数据
typedef ImportFn = Future<({int notesImported, int pagesImported})> Function(String json);

// ── 公开 API ──

/// Push: 本地 → GitHub（版本化）
///
/// 写两个文件：
///   1. {path}-{version}.json — 全量数据快照
///   2. {path}-latest — 文本指针，内容为版本号
Future<SyncConfig> pushToGitHub(
  SyncConfig config, {
  required ExportFn exportData,
  String? commitMessage,
}) async {
  if (!config.isConfigured) {
    throw Exception('请先配置 GitHub Token、Owner 和 Repo');
  }

  final content = await exportData();
  final version = DateTime.now()
      .toUtc()
      .toIso8601String()
      .replaceAll(RegExp(r'[:-]'), '')
      .replaceAll(RegExp(r'\..+'), ''); // "20260715T123000"

  final dataPath = _versionedPath(config.path, version);
  final ptrPath = _latestPath(config.path);

  // 1. 写数据文件（创建，sha=null）
  await putRemote(
    config.token,
    config.owner,
    config.repo,
    dataPath,
    content,
    null,
    commitMessage ?? 'backup: $version',
  );

  // 2. 写 latest 指针
  String? ptrSha;
  try {
    final ptr = await fetchRemote(config.token, config.owner, config.repo, ptrPath);
    ptrSha = ptr?.sha;
  } catch (_) {
    // 文件不存在，sha=null 即 create
  }
  await putRemote(
    config.token,
    config.owner,
    config.repo,
    ptrPath,
    version,
    ptrSha,
    'latest: $version',
  );

  final updated = SyncConfig(
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    path: config.path,
    lastSyncAt: DateTime.now().toUtc().toIso8601String(),
    lastPushVersion: version,
    lastPullVersion: config.lastPullVersion,
  );
  saveSyncConfig(updated);
  return updated;
}

/// Pull: GitHub → 本地（版本化）
///
/// 先读 {path}-latest 指针文件获取版本号 → 再拉对应版本的数据文件。
Future<SyncConfig> pullFromGitHub(
  SyncConfig config, {
  required ImportFn importData,
}) async {
  if (!config.isConfigured) {
    throw Exception('请先配置 GitHub Token、Owner 和 Repo');
  }

  final ptrPath = _latestPath(config.path);

  // 1. 读 latest 指针
  final ptr = await fetchRemote(config.token, config.owner, config.repo, ptrPath);
  if (ptr == null) {
    throw Exception('远端仓库中未找到指针文件 $ptrPath');
  }
  final version = ptr.content.trim();
  if (version.isEmpty) {
    throw Exception('latest 指针文件为空');
  }

  // 2. 拉对应版本的数据
  final dataPath = _versionedPath(config.path, version);
  final remote =
      await fetchRemote(config.token, config.owner, config.repo, dataPath);
  if (remote == null) {
    throw Exception('远端仓库中未找到数据文件 $dataPath');
  }

  // 防御：验证拉取到的内容是有效 JSON
  if (remote.content.trim().isEmpty) {
    final updated = SyncConfig(
      token: config.token,
      owner: config.owner,
      repo: config.repo,
      path: config.path,
      lastSyncAt: DateTime.now().toUtc().toIso8601String(),
      lastPullVersion: version,
      lastPushVersion: config.lastPushVersion,
    );
    saveSyncConfig(updated);
    return updated;
  }
  try {
    jsonDecode(remote.content);
  } catch (_) {
    throw Exception(
        '远端备份文件内容不是有效 JSON（前 100 字符: ${remote.content.substring(0, remote.content.length.clamp(0, 100))}）');
  }

  final result = await importData(remote.content);

  final updated = SyncConfig(
    token: config.token,
    owner: config.owner,
    repo: config.repo,
    path: config.path,
    lastSyncAt: DateTime.now().toUtc().toIso8601String(),
    lastPullVersion: version,
    lastPushVersion: config.lastPushVersion,
  );
  saveSyncConfig(updated);
  return updated;
}

/// 检查连接状态：能否访问仓库，远端是否有备份
Future<SyncStatus> checkStatus(SyncConfig config) async {
  if (!config.isConfigured) {
    return const SyncStatus(ok: false, message: '未配置');
  }

  try {
    final ptrPath = _latestPath(config.path);
    final url =
        'https://api.github.com/repos/${config.owner}/${config.repo}/contents/${Uri.encodeComponent(ptrPath)}';
    final response =
        await _apiRequest(method: 'GET', url: url, headers: _authHeader(config.token));

    if (response.statusCode == 404) {
      return const SyncStatus(ok: true, message: '仓库连接正常，远端暂无备份');
    }
    if (response.statusCode == 401) {
      return const SyncStatus(ok: false, message: 'Token 无效或无权限');
    }
    if (response.statusCode != 200) {
      final body = await response.transform(utf8.decoder).join();
      return SyncStatus(
          ok: false,
          message: 'API ${response.statusCode}: ${body.substring(0, body.length.clamp(0, 100))}');
    }
    return const SyncStatus(ok: true, message: '连接正常');
  } catch (e) {
    return SyncStatus(ok: false, message: '连接失败: $e');
  }
}

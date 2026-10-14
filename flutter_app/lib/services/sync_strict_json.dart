import 'dart:convert';

/// Candidate protocol input only; legacy imports keep their existing parser.
Object? parseSyncJson(String source) {
  var offset = 0;
  Never invalid() => throw const FormatException('同步 JSON 无效、重复键或不安全数字');
  void whitespace() {
    while (offset < source.length && ' \t\r\n'.contains(source[offset])) {
      offset++;
    }
  }

  String string() {
    final start = offset++;
    if (start >= source.length || source[start] != '"') invalid();
    while (offset < source.length) {
      final char = source[offset++];
      if (char == r'\') {
        offset++;
      } else if (char == '"') {
        try {
          return jsonDecode(source.substring(start, offset)) as String;
        } catch (_) {
          invalid();
        }
      }
    }
    invalid();
  }

  final numberToken = RegExp(r'-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?');
  Object? value(int depth) {
    if (depth > 100) invalid();
    whitespace();
    if (offset >= source.length) invalid();
    final char = source[offset];
    if (char == '"') return string();
    if (char == '{' || char == '[') {
      offset++;
      final object = char == '{';
      final result = <String, Object?>{};
      final items = <Object?>[];
      final end = object ? '}' : ']';
      whitespace();
      if (offset < source.length && source[offset] == end) {
        offset++;
        return object ? result : items;
      }
      while (offset < source.length) {
        whitespace();
        if (object) {
          final key = string();
          if (result.containsKey(key)) invalid();
          whitespace();
          if (offset >= source.length || source[offset++] != ':') invalid();
          result[key] = value(depth + 1);
        } else {
          items.add(value(depth + 1));
        }
        whitespace();
        if (offset < source.length && source[offset] == end) {
          offset++;
          return object ? result : items;
        }
        if (offset >= source.length || source[offset++] != ',') invalid();
      }
      invalid();
    }
    for (final entry in {'null': null, 'true': true, 'false': false}.entries) {
      if (source.startsWith(entry.key, offset)) {
        offset += entry.key.length;
        return entry.value;
      }
    }
    final match = numberToken.matchAsPrefix(source, offset);
    if (match == null) invalid();
    offset = match.end;
    final number = double.tryParse(match[0]!);
    if (number == null ||
        !number.isFinite ||
        (number == number.truncateToDouble() &&
            number.abs() > 9007199254740991)) {
      invalid();
    }
    return number;
  }

  final parsed = value(0);
  whitespace();
  if (offset != source.length) invalid();
  return parsed;
}

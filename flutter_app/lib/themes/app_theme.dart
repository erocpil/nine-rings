import 'package:flutter/material.dart';

/// Nine Rings 8 套主题配色 — 与 Web 端 styles.css 完全一致。
///
/// 命名：英文代码名（与 schema/config.yaml enum 对齐），中文显示名独立维护。

class NineRingsTheme {
  final String id;
  final String label;
  final Color swatch;
  final ThemeData data;

  NineRingsTheme({
    required this.id,
    required this.label,
    required this.swatch,
    required this.data,
  });

  /// 全部 8 套主题，按设置面板顺序：浅 → 深 → 暗 → 芙 → 蔚 → 粋 → 雅 → 幟
  static final Map<String, NineRingsTheme> all = {
    'light': _light,
    'dark': _dark,
    'azure-dark': _azureDark,
    'fu': _fu,
    'azure': _azure,
    'sui': _sui,
    'grace': _grace,
    'zhi': _zhi,
  };

  static const defaultId = 'dark';

  // ── 辅助：非 const 的 ColorScheme ──

  static ColorScheme _lightScheme(
    Color bg, Color surface, Color border,
    Color text, Color textSecondary, Color accent, Color danger,
  ) {
    return ColorScheme(
      brightness: Brightness.light,
      surface: bg,
      onSurface: text,
      onSurfaceVariant: textSecondary,
      primary: accent,
      onPrimary: const Color(0xFFFFFFFF),
      secondary: accent,
      onSecondary: const Color(0xFFFFFFFF),
      error: danger,
      onError: const Color(0xFFFFFFFF),
    );
  }

  static ColorScheme _darkScheme(
    Color bg, Color surface, Color border,
    Color text, Color textSecondary, Color accent, Color danger,
  ) {
    return ColorScheme(
      brightness: Brightness.dark,
      surface: bg,
      onSurface: text,
      onSurfaceVariant: textSecondary,
      primary: accent,
      onPrimary: const Color(0xFF0D1117),
      secondary: accent,
      onSecondary: const Color(0xFF0D1117),
      error: danger,
      onError: const Color(0xFF0D1117),
    );
  }

  static ThemeData _theme(Brightness brightness,
    Color bg, Color surface, Color border,
    Color text, Color textSecondary, Color accent, Color danger,
  ) {
    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      scaffoldBackgroundColor: bg,
      cardColor: surface,
      dividerColor: border,
      colorScheme: brightness == Brightness.light
          ? _lightScheme(bg, surface, border, text, textSecondary, accent, danger)
          : _darkScheme(bg, surface, border, text, textSecondary, accent, danger),
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        backgroundColor: bg,
        foregroundColor: text,
      ),
    );
  }

  // ═══════════════════════════════════════════
  // 1. 浅 (light)
  // ═══════════════════════════════════════════

  static final _light = NineRingsTheme(
    id: 'light',
    label: '浅',
    swatch: const Color(0xFFE2E2E2),
    data: _theme(Brightness.light,
      const Color(0xFFFFFFFF), // bg
      const Color(0xFFF6F8FA), // surface
      const Color(0xFFD0D7DE), // border
      const Color(0xFF1F2328), // text
      const Color(0xFF656D76), // text-secondary
      const Color(0xFF0969DA), // accent
      const Color(0xFFCF222E), // danger
    ),
  );

  // ═══════════════════════════════════════════
  // 2. 深 (dark)
  // ═══════════════════════════════════════════

  static final _dark = NineRingsTheme(
    id: 'dark',
    label: '深',
    swatch: const Color(0xFF0D1117),
    data: _theme(Brightness.dark,
      const Color(0xFF0D1117),
      const Color(0xFF161B22),
      const Color(0xFF30363D),
      const Color(0xFFE6EDF3),
      const Color(0xFF8B949E),
      const Color(0xFF58A6FF),
      const Color(0xFFF85149),
    ),
  );

  // ═══════════════════════════════════════════
  // 3. 暗 (azure-dark)
  // ═══════════════════════════════════════════

  static final _azureDark = NineRingsTheme(
    id: 'azure-dark',
    label: '暗',
    swatch: const Color(0xFF1E3050),
    data: _theme(Brightness.dark,
      const Color(0xFF0D1628),
      const Color(0xFF111D35),
      const Color(0xFF1E3050),
      const Color(0xFFDCE4F0),
      const Color(0xFF7A8FAD),
      const Color(0xFF3B6DCC),
      const Color(0xFFF25A6A),
    ),
  );

  // ═══════════════════════════════════════════
  // 4. 芙 (fu)
  // ═══════════════════════════════════════════

  static final _fu = NineRingsTheme(
    id: 'fu',
    label: '芙',
    swatch: const Color(0xFF81D8D0),
    data: _theme(Brightness.light,
      const Color(0xFFF5FBFA),
      const Color(0xFFEBF6F4),
      const Color(0xFFC0E0DB),
      const Color(0xFF1A2C2A),
      const Color(0xFF5A7A74),
      const Color(0xFF0ABAB5),
      const Color(0xFFD44A5A),
    ),
  );

  // ═══════════════════════════════════════════
  // 5. 蔚 (azure)
  // ═══════════════════════════════════════════

  static final _azure = NineRingsTheme(
    id: 'azure',
    label: '蔚',
    swatch: const Color(0xFF3B6DCC),
    data: _theme(Brightness.light,
      const Color(0xFFF4F7FB),
      const Color(0xFFEAF0F8),
      const Color(0xFFC8D6E8),
      const Color(0xFF1A2538),
      const Color(0xFF5A6D8A),
      const Color(0xFF3B6DCC),
      const Color(0xFFD43B4A),
    ),
  );

  // ═══════════════════════════════════════════
  // 6. 粋 (sui)
  // ═══════════════════════════════════════════

  static final _sui = NineRingsTheme(
    id: 'sui',
    label: '粋',
    swatch: const Color(0xFF4A8A3A),
    data: _theme(Brightness.light,
      const Color(0xFFF2F7F0),
      const Color(0xFFE8F0E4),
      const Color(0xFFC8DCC0),
      const Color(0xFF1E2A1C),
      const Color(0xFF5C7A52),
      const Color(0xFF4A8A3A),
      const Color(0xFFC44A3A),
    ),
  );

  // ═══════════════════════════════════════════
  // 7. 雅 (grace)
  // ═══════════════════════════════════════════

  static final _grace = NineRingsTheme(
    id: 'grace',
    label: '雅',
    swatch: const Color(0xFF7C3AED),
    data: _theme(Brightness.light,
      const Color(0xFFFAF6FC),
      const Color(0xFFF3EDF7),
      const Color(0xFFE6DEF0),
      const Color(0xFF2C2B2E),
      const Color(0xFF6E6B73),
      const Color(0xFF8B6FC0),
      const Color(0xFFD43B5A),
    ),
  );

  // ═══════════════════════════════════════════
  // 8. 幟 (zhi)
  // ═══════════════════════════════════════════

  static final _zhi = NineRingsTheme(
    id: 'zhi',
    label: '幟',
    swatch: const Color(0xFFC49A3C),
    data: _theme(Brightness.light,
      const Color(0xFFFBF7F0),
      const Color(0xFFF5EDE0),
      const Color(0xFFE6D8C0),
      const Color(0xFF2C2518),
      const Color(0xFF8A7A5A),
      const Color(0xFFC49A3C),
      const Color(0xFFC44A3A),
    ),
  );
}

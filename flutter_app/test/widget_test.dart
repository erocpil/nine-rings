import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'package:nine_rings/main.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting();
  });

  testWidgets('renders the application shell', (WidgetTester tester) async {
    await tester.pumpWidget(const NineRingsApp());

    expect(find.text('文档工作区'), findsOneWidget);
    expect(find.text('随笔'), findsNothing);
    expect(find.text('待办'), findsNothing);
    expect(
      find.byWidgetPredicate(
        (widget) => widget is NavigationDestination && widget.label == '文档',
      ),
      findsOneWidget,
    );
    expect(
      find.byWidgetPredicate(
        (widget) => widget is NavigationDestination && widget.label == '概念',
      ),
      findsOneWidget,
    );
  });
}

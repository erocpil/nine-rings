import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'package:nine_rings/main.dart';

void main() {
  setUpAll(() async {
    await initializeDateFormatting();
  });

  testWidgets('renders the application shell', (WidgetTester tester) async {
    await tester.pumpWidget(const NineRingsApp());

    expect(find.text('随笔'), findsOneWidget);
    expect(find.text('文档'), findsOneWidget);
    expect(find.text('概念'), findsOneWidget);
  });
}

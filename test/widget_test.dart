import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';

void main() {
  testWidgets('login does not offer simulated provider authentication', (
    tester,
  ) async {
    await tester.pumpWidget(
      ChangeNotifierProvider(
        create: (_) => AuthProvider(),
        child: const MaterialApp(home: LoginPage()),
      ),
    );
    expect(find.text('GACHIGACHA'), findsOneWidget);
    expect(find.text('이메일로 로그인'), findsOneWidget);
    expect(find.text('카카오로 시작하기'), findsNothing);
    await tester.ensureVisible(find.text('이메일로 로그인'));
    await tester.tap(find.text('이메일로 로그인'));
    await tester.pump();
    expect(find.text('이메일과 비밀번호를 입력해주세요'), findsOneWidget);
  });
}

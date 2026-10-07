import 'package:flutter_test/flutter_test.dart';
import 'package:gacha_vault/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('저장된 토큰이 없으면 로그인 화면을 보여준다', (tester) async {
    await tester.pumpWidget(const GachaVaultApp());
    await tester.pumpAndSettle();

    expect(find.text('카카오로 시작하기'), findsOneWidget);
    expect(find.text('이메일로 로그인'), findsOneWidget);
    expect(find.text('로그인'), findsOneWidget);
    expect(find.textContaining('확률을 공개'), findsOneWidget);
  });

  testWidgets('빈 칸으로 로그인하면 안내를 띄우고 요청하지 않는다', (tester) async {
    await tester.pumpWidget(const GachaVaultApp());
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('로그인'));
    await tester.tap(find.text('로그인'));
    await tester.pump();

    expect(find.text('이메일과 비밀번호를 입력해 주세요'), findsOneWidget);
  });
}

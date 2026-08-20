// 가치가차 앱 기본 위젯 테스트.
//
// 앱 시작 시 로그인 페이지가 표시되고, 이메일 로그인 시 하단 4탭
// 홈 화면으로 전환되는지 확인합니다.

import 'package:flutter_test/flutter_test.dart';

import 'package:gacha_vault/main.dart';

void main() {
  testWidgets('GachaVaultApp shows LoginPage when not logged in', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const GachaVaultApp());

    expect(find.text('GACHIGACHA'), findsOneWidget);
    expect(find.text('당신의 가치를 뽑아보세요'), findsOneWidget);
    expect(find.text('카카오로 시작하기'), findsOneWidget);
    expect(find.text('구글로 시작하기'), findsOneWidget);
    expect(find.text('네이버로 시작하기'), findsOneWidget);
    expect(find.text('Apple로 시작하기'), findsOneWidget);
    expect(find.text('이메일로 로그인'), findsOneWidget);
  });

  testWidgets('Tapping social login button shows coming soon snackbar', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const GachaVaultApp());

    await tester.tap(find.text('카카오로 시작하기'));
    await tester.pump();

    expect(find.text('카카오 로그인은 아직 준비중입니다'), findsOneWidget);
  });

  testWidgets('Email login navigates to main tab (Home) screen', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(const GachaVaultApp());

    await tester.ensureVisible(find.text('이메일로 로그인'));
    await tester.pump();
    await tester.tap(find.text('이메일로 로그인'));
    // 홈 화면의 WinnerTicker(실시간 당첨 티커)가 무한 반복(repeat)
    // 애니메이션을 사용하므로 pumpAndSettle() 대신 고정 프레임만 pump한다.
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('홈'), findsOneWidget);
    expect(find.text('랭킹'), findsOneWidget);
    // '박스'는 하단 네비게이션 탭 라벨과 홈 화면 카테고리 탭에 모두
    // 존재하므로 findsWidgets(2개 이상)로 확인한다.
    expect(find.text('박스'), findsWidgets);
    expect(find.text('충전'), findsOneWidget);
    expect(find.text('마이'), findsOneWidget);

    // 새 홈 화면 콘텐츠 확인
    expect(find.text('인기 랜덤박스'), findsOneWidget);
    expect(find.text('추천'), findsOneWidget);
    expect(find.text('명품'), findsOneWidget);
    expect(find.textContaining('GP'), findsWidgets);
  });
}

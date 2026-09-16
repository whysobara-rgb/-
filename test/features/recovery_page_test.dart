import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/recovery/recovery_page.dart';
import 'package:gacha_vault/features/recovery/recovery_repository.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import '../support/recovery_fixture.dart';

Future<void> mountRecovery(WidgetTester t, RecoveryFixture f,
    {bool verify = false, double scale = 1}) async {
  await f.initialize(signedIn: verify);
  await t.pumpWidget(ChangeNotifierProvider.value(value: f.auth,
    child: MaterialApp(builder: (context, child) => MediaQuery(
      data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)), child: child!),
      home: RecoveryPage(verifyEmail: verify, repository: f.repository))));
  await t.pumpAndSettle();
}
Future<void> pressRecovery(WidgetTester t, String key) async {
  await t.ensureVisible(find.byKey(Key(key))); await t.pumpAndSettle();
  await t.tap(find.byKey(Key(key))); await t.pumpAndSettle();
}
Future<void> enterRecovery(WidgetTester t, String key, String value) async {
  await t.ensureVisible(find.byKey(Key(key))); await t.enterText(find.byKey(Key(key)), value);
  FocusManager.instance.primaryFocus?.unfocus(); await t.pumpAndSettle();
}
Future<void> resetFields(WidgetTester t) async {
  await enterRecovery(t, 'recovery-link', resetLink);
  await enterRecovery(t, 'recovery-next', 'newTest123!');
  await enterRecovery(t, 'recovery-repeat', 'newTest123!');
}
Future<void> disposeRecovery(WidgetTester t, RecoveryFixture f) async {
  await t.pumpWidget(const SizedBox.shrink()); f.dispose();
}

void main() {
  testWidgets('mail request reports acceptance not delivery and throttles taps', (t) async {
    final f = RecoveryFixture(); await mountRecovery(t, f);
    await enterRecovery(t, 'recovery-email', 'u1@example.invalid');
    await pressRecovery(t, 'recovery-request');
    expect(find.text(recoveryAcceptedMessage), findsOneWidget);
    expect(f.posts.length, 1);
    expect(t.widget<FilledButton>(find.byKey(const Key('recovery-request'))).onPressed, isNull);
    await disposeRecovery(t, f);
  });
  testWidgets('disabled server exposes no active request or completion controls', (t) async {
    final f = RecoveryFixture()..enabled = false; await mountRecovery(t, f);
    expect(find.byKey(const Key('recovery-request')), findsNothing);
    expect(find.byKey(const Key('recovery-complete')), findsNothing);
    expect(find.text('상태 다시 조회'), findsOneWidget); expect(f.posts, isEmpty);
    await disposeRecovery(t, f);
  });
  testWidgets('missing origin prevents pasting and consuming links', (t) async {
    final f = RecoveryFixture(origin: ''); await mountRecovery(t, f);
    expect(find.byKey(const Key('recovery-link')), findsNothing);
    expect(find.byKey(const Key('recovery-request')), findsOneWidget);
    expect(find.textContaining('서비스 주소 설정이 아직 없습니다'), findsOneWidget);
    await disposeRecovery(t, f);
  });
  testWidgets('wrong-purpose link and mismatched password never submit', (t) async {
    final f = RecoveryFixture(); await mountRecovery(t, f); await resetFields(t);
    await enterRecovery(t, 'recovery-link', verifyLink); await pressRecovery(t, 'recovery-complete');
    expect(f.posts, isEmpty);
    await enterRecovery(t, 'recovery-link', resetLink);
    await enterRecovery(t, 'recovery-repeat', 'differentTest1'); await pressRecovery(t, 'recovery-complete');
    expect(find.text('새 비밀번호가 일치하지 않습니다'), findsOneWidget); expect(f.posts, isEmpty);
    await disposeRecovery(t, f);
  });
  testWidgets('confirmation cancellation leaves server untouched', (t) async {
    final f = RecoveryFixture(); await mountRecovery(t, f); await resetFields(t);
    await pressRecovery(t, 'recovery-complete');
    expect(find.byType(CircularProgressIndicator), findsNothing);
    await t.tap(find.text('취소')); await t.pumpAndSettle(); expect(f.posts, isEmpty);
    await disposeRecovery(t, f);
  });
  testWidgets('reset succeeds once only after confirmation and never auto logs in', (t) async {
    final f = RecoveryFixture(); await mountRecovery(t, f); await resetFields(t);
    await pressRecovery(t, 'recovery-complete'); await pressRecovery(t, 'recovery-confirm');
    expect(f.posts.single.url.path, '/auth/recovery/reset');
    expect(find.text('비밀번호가 재설정됐습니다. 새 비밀번호로 다시 로그인해주세요.'), findsOneWidget);
    expect(f.auth.isLoggedIn, isFalse); expect(f.storage.value, isNull);
    expect(find.byKey(const Key('recovery-complete')), findsNothing);
    await disposeRecovery(t, f);
  });
  testWidgets('ambiguous reset clears secrets, does not claim success or replay', (t) async {
    final f = RecoveryFixture();
    f.handlers['/auth/recovery/reset'] = (_) async => throw http.ClientException('SECRET_TOKEN_SENTINEL');
    await mountRecovery(t, f); await resetFields(t);
    await pressRecovery(t, 'recovery-complete'); await pressRecovery(t, 'recovery-confirm');
    expect(f.posts.length, 1); expect(find.textContaining('자동 재시도하지 않았습니다'), findsOneWidget);
    expect(find.textContaining('SECRET_TOKEN_SENTINEL'), findsNothing);
    for (final key in ['recovery-link','recovery-next','recovery-repeat']) {
      expect(t.widget<TextField>(find.byKey(Key(key))).controller!.text, isEmpty);
    }
    await disposeRecovery(t, f);
  });
  testWidgets('expired token reports fixed guidance without echoing backend details', (t) async {
    final f = RecoveryFixture(); f.handlers['/auth/recovery/reset'] = (_) async => recoveryFailure(400);
    await mountRecovery(t, f); await resetFields(t);
    await pressRecovery(t, 'recovery-complete'); await pressRecovery(t, 'recovery-confirm');
    expect(find.textContaining('만료되거나 사용된 링크'), findsOneWidget);
    expect(find.textContaining('SYNTHETIC_SECRET'), findsNothing); expect(f.posts.length, 1);
    await disposeRecovery(t, f);
  });
  testWidgets('verified status is read from the server instead of optimistic mutation', (t) async {
    final f = RecoveryFixture(); await mountRecovery(t, f, verify:true);
    expect(find.text('이메일 미인증'), findsOneWidget);
    await enterRecovery(t, 'recovery-link', verifyLink);
    await pressRecovery(t, 'recovery-complete'); await pressRecovery(t, 'recovery-confirm');
    expect(find.text('이메일 인증 완료'), findsOneWidget);
    expect(f.requests.where((r) => r.url.path == '/account/email').length, 2);
    expect(f.auth.isLoggedIn, isTrue);
    await disposeRecovery(t, f);
  });
  testWidgets('a valid token for another address does not mark this account verified', (t) async {
    final f = RecoveryFixture();
    f.handlers['/auth/recovery/verify'] = (_) async => recoveryOk({'verified':true});
    await mountRecovery(t, f, verify:true); await enterRecovery(t, 'recovery-link', verifyLink);
    await pressRecovery(t, 'recovery-complete'); await pressRecovery(t, 'recovery-confirm');
    expect(find.text('이메일 미인증'), findsOneWidget);
    expect(find.textContaining('현재 계정의 이메일은 미인증'), findsOneWidget);
    await disposeRecovery(t, f);
  });
  testWidgets('backgrounding clears hidden inputs and cancels pending confirmation', (t) async {
    final f = RecoveryFixture(); await mountRecovery(t, f); await resetFields(t);
    for (final key in ['recovery-link','recovery-next','recovery-repeat']) {
      expect(t.widget<TextField>(find.byKey(Key(key))).obscureText, isTrue);
    }
    await pressRecovery(t, 'recovery-complete');
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive); await t.pump();
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed); await t.pump();
    await pressRecovery(t, 'recovery-confirm'); expect(f.posts, isEmpty);
    expect(t.widget<TextField>(find.byKey(const Key('recovery-link'))).controller!.text, isEmpty);
    await disposeRecovery(t, f);
  });
  testWidgets('login while recovery response is delayed clears this page, not the new login', (t) async {
    final barrier = Completer<http.Response>(); final f = RecoveryFixture();
    f.handlers['/auth/recovery/reset'] = (_) => barrier.future;
    await mountRecovery(t, f); await resetFields(t); await pressRecovery(t, 'recovery-complete');
    await pressRecovery(t, 'recovery-confirm'); expect(f.posts.length, 1);
    f.user = 2; await f.auth.login(email:'u2@example.invalid', password:'synthetic'); await t.pump();
    barrier.complete(recoveryOk({'changed':true,'reauthenticate':true})); await t.pumpAndSettle();
    expect(f.auth.currentUser!.id, 2); expect(f.storage.value, 'synthetic-2');
    expect(find.byKey(const Key('recovery-link')), findsNothing);
    expect(find.textContaining('로그인 상태가 바뀌었습니다'), findsOneWidget);
    await disposeRecovery(t, f);
  });
  testWidgets('small viewport with 2x text remains accessible and scrollable', (t) async {
    t.view.physicalSize = const Size(360,800); t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize); addTearDown(t.view.resetDevicePixelRatio);
    final f = RecoveryFixture(); await mountRecovery(t, f, scale:2);
    await t.ensureVisible(find.byKey(const Key('recovery-complete'))); await t.pumpAndSettle();
    expect(t.takeException(), isNull);
    expect(t.getRect(find.byKey(const Key('recovery-complete'))).height, greaterThanOrEqualTo(48));
    final semantics = t.ensureSemantics();
    await expectLater(t, meetsGuideline(labeledTapTargetGuideline)); semantics.dispose();
    await disposeRecovery(t, f);
  });
  testWidgets('login page exposes a real recovery route', (t) async {
    final f = RecoveryFixture(); await f.initialize();
    await t.pumpWidget(ChangeNotifierProvider.value(value:f.auth,
      child:const MaterialApp(home:LoginPage()))); await t.pumpAndSettle();
    await pressRecovery(t, 'login-recovery');
    expect(find.byType(RecoveryPage), findsOneWidget);
    await disposeRecovery(t, f);
  });
}

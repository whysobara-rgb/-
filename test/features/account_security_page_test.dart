import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:provider/provider.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/account_security/account_security_page.dart';
import 'package:gacha_vault/features/account_security/account_security_repository.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'account_security_repository_test.dart' show MemoryToken, ok, caps;

class SecurityFixture {
  final storage = MemoryToken();
  late final http.Client client;
  late final ApiClient api;
  late final AuthProvider auth;
  final writes = <String>[];
  int profileId = 1;
  int capabilityStatus = 200;
  bool enabled = true;
  Future<http.Response> Function(http.Request)? mutation;

  SecurityFixture() {
    client = MockClient((r) async {
      if (r.url.path == '/users/me') {
        return ok({'id':profileId,'email':'test@example.invalid','nickname':'시험 계정','coinBalance':100});
      }
      if (r.url.path == '/auth/login') return ok({'accessToken':'synthetic-token-$profileId'});
      if (r.url.path == '/account/capabilities') {
        return capabilityStatus == 200 ? ok({...caps,'enabled':enabled})
            : http.Response(jsonEncode({'statusCode':40000,'message':'synthetic unavailable'}), capabilityStatus);
      }
      writes.add(r.url.path);
      if (mutation != null) return mutation!(r);
      return ok({r.url.path.endsWith('/password') ? 'changed' : 'revoked':true,
        'reauthenticate':true});
    });
    api = ApiClient(client: client, tokenStorage: storage);
    auth = AuthProvider(apiClient: api, tokenStorage: storage);
  }
  Future<void> login() => auth.tryAutoLogin();
  void dispose() { auth.dispose(); client.close(); }
}

Future<void> mount(WidgetTester tester, SecurityFixture f, {double scale = 1}) async {
  await f.login();
  await tester.pumpWidget(ChangeNotifierProvider.value(value: f.auth,
    child: MaterialApp(
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: TextScaler.linear(scale)),
        child: child!,
      ),
      home: AccountSecurityPage(repository: AccountSecurityRepository(api: f.api)),
    ),
  ));
  await tester.pumpAndSettle();
}
Future<void> fill(WidgetTester t, {bool change = true, String repeat = 'nextTest456!'}) async {
  await t.ensureVisible(find.byKey(const Key('security-current')));
  await t.enterText(find.byKey(const Key('security-current')), 'oldTest123!');
  if (change) {
    await t.ensureVisible(find.byKey(const Key('security-next')));
    await t.enterText(find.byKey(const Key('security-next')), 'nextTest456!');
    await t.ensureVisible(find.byKey(const Key('security-repeat')));
    await t.enterText(find.byKey(const Key('security-repeat')), repeat);
  }
  FocusManager.instance.primaryFocus?.unfocus();
  await t.pumpAndSettle();
}
Future<void> press(WidgetTester t, String key) async {
  await t.ensureVisible(find.byKey(Key(key)));
  await t.tap(find.byKey(Key(key))); await t.pumpAndSettle();
}
Future<void> unmount(WidgetTester t, SecurityFixture f) async {
  await t.pumpWidget(const SizedBox.shrink()); f.dispose();
}

void main() {
  testWidgets('shows existing server feature and hides all password values', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t);
    final fields = t.widgetList<TextFormField>(find.byType(TextFormField)).toList();
    expect(fields.length, 3);
    for (final e in t.widgetList<EditableText>(find.byType(EditableText))) {
      expect(e.obscureText, isTrue); expect(e.autocorrect, isFalse);
      expect(e.enableSuggestions, isFalse);
    }
    expect(f.writes, isEmpty); await unmount(t, f);
  });
  testWidgets('mismatched confirmation does not send a request', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t, repeat:'notMatching1');
    await press(t, 'security-change');
    expect(find.text('새 비밀번호가 일치하지 않습니다'), findsOneWidget);
    expect(f.writes, isEmpty); await unmount(t, f);
  });
  testWidgets('confirmation cancellation never sends the password', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t);
    await press(t, 'security-change'); await t.tap(find.text('취소')); await t.pumpAndSettle();
    expect(f.writes, isEmpty); expect(f.auth.isLoggedIn, isTrue); await unmount(t, f);
  });
  testWidgets('confirmed password change calls API once then clears local authentication', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t);
    await press(t, 'security-change'); await press(t, 'security-confirm-action');
    expect(f.writes, ['/account/password']); expect(f.storage.value, isNull);
    expect(f.auth.isLoggedIn, isFalse);
    expect(find.text('비밀번호가 변경됐습니다. 새 비밀번호로 다시 로그인해주세요.'), findsOneWidget);
    await unmount(t, f);
  });
  testWidgets('revoke only requires the current password', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t, change:false);
    await press(t, 'security-revoke'); await press(t, 'security-confirm-action');
    expect(f.writes, ['/account/revoke-sessions']); expect(f.storage.value, isNull);
    expect(find.text('기존 로그인이 해제됐습니다. 다시 로그인해주세요.'), findsOneWidget);
    await unmount(t, f);
  });
  testWidgets('ambiguous response logs out locally without automatic resubmission', (t) async {
    final f = SecurityFixture()..mutation = (_) async => throw http.ClientException('synthetic-private-detail');
    await mount(t, f); await fill(t);
    await press(t, 'security-change'); await press(t, 'security-confirm-action');
    expect(f.writes.length, 1); expect(f.auth.isLoggedIn, isFalse);
    expect(find.textContaining('자동 재시도하지 않았습니다'), findsOneWidget);
    expect(find.textContaining('synthetic-private-detail'), findsNothing);
    await unmount(t, f);
  });
  testWidgets('server rejection clears input and does not claim success or logout', (t) async {
    final f = SecurityFixture()..mutation = (_) async => http.Response(
        jsonEncode({'statusCode':40000,'message':'synthetic-password-sentinel'}), 400);
    await mount(t, f); await fill(t);
    await press(t, 'security-change'); await press(t, 'security-confirm-action');
    expect(f.auth.isLoggedIn, isTrue); expect(f.writes.length, 1);
    for (final e in t.widgetList<EditableText>(find.byType(EditableText))) { expect(e.controller.text, isEmpty); }
    expect(find.textContaining('synthetic-password-sentinel'), findsNothing);
    await unmount(t, f);
  });
  testWidgets('old server and unavailable capabilities expose retry, not active actions', (t) async {
    final f = SecurityFixture()..capabilityStatus = 404; await mount(t, f);
    expect(find.text('다시 조회'), findsOneWidget);
    expect(find.byKey(const Key('security-change')), findsNothing);
    f.capabilityStatus = 200; f.enabled = false;
    await t.tap(find.text('다시 조회')); await t.pumpAndSettle();
    expect(find.text('계정 보안 기능을 준비하고 있습니다.'), findsOneWidget);
    expect(f.writes, isEmpty); await unmount(t, f);
  });
  testWidgets('leaving foreground clears secret fields', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t);
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive); await t.pump();
    for (final e in t.widgetList<EditableText>(find.byType(EditableText))) { expect(e.controller.text, isEmpty); }
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed); await t.pump();
    expect(f.writes, isEmpty); await unmount(t, f);
  });
  testWidgets('logout while a confirmation is open prevents dispatch', (t) async {
    final f = SecurityFixture(); await mount(t, f); await fill(t);
    await press(t, 'security-change'); await f.auth.logout(); await t.pump();
    await press(t, 'security-confirm-action'); expect(f.writes, isEmpty);
    await unmount(t, f);
  });
  testWidgets('a delayed mutation response cannot log a new account out', (t) async {
    final response = Completer<http.Response>();
    final f = SecurityFixture()..mutation = (_) => response.future;
    await mount(t, f); await fill(t); await press(t, 'security-change');
    await t.tap(find.byKey(const Key('security-confirm-action')));
    await t.pumpAndSettle(); expect(f.writes.length, 1);
    await f.auth.logout(); f.profileId = 2;
    await f.auth.login(email:'new@example.invalid', password:'not-real');
    response.complete(ok({'changed':true,'reauthenticate':true})); await t.pumpAndSettle();
    expect(f.auth.currentUser!.id, 2); expect(f.storage.value, 'synthetic-token-2');
    await unmount(t, f);
  });
  testWidgets('small viewport and 2.5x text remain scrollable without overflow', (t) async {
    t.view.physicalSize = const Size(360, 800); t.view.devicePixelRatio = 1;
    addTearDown(t.view.resetPhysicalSize); addTearDown(t.view.resetDevicePixelRatio);
    final f = SecurityFixture(); await mount(t, f, scale:2.5);
    await t.ensureVisible(find.byKey(const Key('security-revoke'))); await t.pumpAndSettle();
    expect(t.takeException(), isNull);
    final rect = t.getRect(find.byKey(const Key('security-revoke')));
    expect(rect.height, greaterThanOrEqualTo(48));
    final semantics = t.ensureSemantics();
    await expectLater(t, meetsGuideline(labeledTapTargetGuideline));
    semantics.dispose(); await unmount(t, f);
  });
}

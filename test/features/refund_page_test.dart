import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/refunds/order_history_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import '../support/refund_fixture.dart';

Future<AuthProvider> mountRefund(WidgetTester t,RefundFixture f,
    {bool history=false,double scale=1}) async {
  final auth=AuthProvider(apiClient:f.api,tokenStorage:f.token);
  await auth.tryAutoLogin();expect(auth.isLoggedIn,isTrue);
  final generation=auth.sessionGeneration;
  f.additionalLease=()=>auth.isSessionCurrent(generation);
  final repo=f.repository();
  await t.pumpWidget(ChangeNotifierProvider.value(value:auth,child:MaterialApp(
    builder:(context,child)=>MediaQuery(data:MediaQuery.of(context).copyWith(textScaler:TextScaler.linear(scale)),child:child!),
    home:history?OrderHistoryPage(repository:repo):OrderRefundPage(orderId:orderId,repository:repo),
  )));
  await t.pumpAndSettle();return auth;
}
Future<void> revealRefund(WidgetTester t, String key) async {
  final finder = find.byKey(Key(key));
  if (finder.evaluate().isEmpty) {
    final scroll = find.byType(Scrollable).first;
    t.state<ScrollableState>(scroll).position.jumpTo(0);
    await t.pumpAndSettle();
    await t.scrollUntilVisible(finder, 160, scrollable: scroll, maxScrolls: 40);
  } else {
    await t.ensureVisible(finder);
  }
  await t.pumpAndSettle();
}
Future<void> pressRefund(WidgetTester t,String key) async {
  await revealRefund(t, key);
  await t.tap(find.byKey(Key(key)));await t.pumpAndSettle();
}
Future<void> consentRefund(WidgetTester t) async {
  await pressRefund(t,'refund-capsule-$firstCapsule');
  await pressRefund(t,'refund-quote');
  await revealRefund(t, 'refund-reason');
  await t.enterText(find.byKey(const Key('refund-reason')),'시험 환불 사유');
  FocusManager.instance.primaryFocus?.unfocus();await t.pumpAndSettle();
  await pressRefund(t,'refund-consent');
}
Future<void> unmountRefund(WidgetTester t,AuthProvider a,RefundFixture f) async {
  await t.pumpWidget(const SizedBox.shrink());a.dispose();f.dispose();
}
void main() {
  testWidgets('history navigates to the same order and does not mutate', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f,history:true);
    await pressRefund(t,'history-order-$orderId');
    expect(find.text('주문 상세·환불'),findsOneWidget);
    expect(find.textContaining(orderId),findsWidgets);expect(f.mutations,isEmpty);
    await unmountRefund(t,a,f);
  });
  testWidgets('opened capsule is disabled and consent is required before submit', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f);
    expect(t.widget<CheckboxListTile>(find.byKey(const Key('refund-capsule-$thirdCapsule'))).onChanged,isNull);
    await pressRefund(t,'refund-capsule-$firstCapsule');await pressRefund(t,'refund-quote');
    await revealRefund(t, 'refund-submit');
    expect(t.widget<FilledButton>(find.byKey(const Key('refund-submit'))).onPressed,isNull);
    expect(f.mutations,isEmpty);await unmountRefund(t,a,f);
  });
  testWidgets('select quote confirm refund and acknowledge form one GP flow', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f);await consentRefund(t);
    await pressRefund(t,'refund-submit');expect(f.mutations,isEmpty);
    expect(find.byType(LinearProgressIndicator), findsNothing);
    await pressRefund(t,'refund-confirm');expect(f.mutations.length,1);
    expect(find.text('환불 처리 완료'),findsOneWidget);
    await pressRefund(t,'refund-ack');expect(f.store.values,isEmpty);
    expect(find.textContaining('환불 완료 1개'),findsOneWidget);
    expect(f.mutations.length,1);await unmountRefund(t,a,f);
  });
  testWidgets('card flow says original-card cancellation and never GP credit', (t)async {
    final f=RefundFixture(currency:'KRW');final a=await mountRefund(t,f);await consentRefund(t);
    expect(find.textContaining('원결제 카드 취소'),findsOneWidget);
    await pressRefund(t,'refund-submit');await pressRefund(t,'refund-confirm');
    expect(f.receipt!['currency'],'KRW');expect(f.receipt!['balanceAfter'],isNull);
    expect(f.mutations.length,1);await unmountRefund(t,a,f);
  });
  testWidgets('cancelling confirmation never submits a refund', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f);await consentRefund(t);
    await pressRefund(t,'refund-submit');await t.tap(find.text('취소'));await t.pumpAndSettle();
    expect(f.mutations,isEmpty);expect(f.store.values,isEmpty);await unmountRefund(t,a,f);
  });
  testWidgets('selection changes invalidate old quote and consent', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f);await consentRefund(t);
    await pressRefund(t,'refund-capsule-$secondCapsule');
    expect(find.byKey(const Key('refund-submit')),findsNothing);
    expect(f.mutations,isEmpty);await unmountRefund(t,a,f);
  });
  testWidgets('failed quote refresh hides the previous actionable amount', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f);await consentRefund(t);
    f.quoteHandler=(_)async=>reject(409,10005);await pressRefund(t,'refund-quote');
    expect(find.byKey(const Key('refund-submit')),findsNothing);
    expect(find.byKey(const Key('refund-message')),findsOneWidget);
    expect(f.mutations,isEmpty);await unmountRefund(t,a,f);
  });
  testWidgets('missing historical terms show support without declaring no refund rights', (t)async {
    final f=RefundFixture();f.data['refundEligible']=false;f.data['refundUntil']=null;f.data['refundPolicy']=null;
    final a=await mountRefund(t,f);
    expect(find.textContaining('모든 환불 권리를 부정하는 것은 아닙니다'),findsOneWidget);
    expect(t.widget<CheckboxListTile>(find.byKey(const Key('refund-capsule-$firstCapsule'))).onChanged,isNull);
    expect(f.mutations,isEmpty);await unmountRefund(t,a,f);
  });
  testWidgets('lost response offers read-only recovery without resending', (t)async {
    final f=RefundFixture();f.mutationHandler=(r)async{f.record(r);throw http.ClientException('lost');};
    final a=await mountRefund(t,f);await consentRefund(t);await pressRefund(t,'refund-submit');await pressRefund(t,'refund-confirm');
    expect(f.mutations.length,1);expect(find.byKey(const Key('refund-recover')),findsOneWidget);
    await pressRefund(t,'refund-recover');expect(find.text('환불 처리 완료'),findsOneWidget);
    expect(f.mutations.length,1);await unmountRefund(t,a,f);
  });
  testWidgets('UNKNOWN provider result has no replay or success button', (t)async {
    final f=RefundFixture(currency:'KRW');f.mutationHandler=(r)async{f.record(r,status:'UNKNOWN');return response(f.receipt);};
    final a=await mountRefund(t,f);await consentRefund(t);await pressRefund(t,'refund-submit');await pressRefund(t,'refund-confirm');
    expect(find.text('결제사 결과 확인 필요'),findsOneWidget);
    expect(find.byKey(const Key('refund-retry')),findsNothing);expect(find.byKey(const Key('refund-ack')),findsNothing);
    expect(f.mutations.length,1);await unmountRefund(t,a,f);
  });
  testWidgets('logging out inside the confirmation prevents dispatch', (t)async {
    final f=RefundFixture();final a=await mountRefund(t,f);await consentRefund(t);
    await pressRefund(t,'refund-submit');await a.logout();await t.pump();
    await pressRefund(t,'refund-confirm');expect(f.mutations,isEmpty);
    expect(find.textContaining(orderId),findsNothing);await unmountRefund(t,a,f);
  });
  testWidgets('small viewport with 2x text displays selection and quote without overflow', (t)async {
    t.view.physicalSize=const Size(360,800);t.view.devicePixelRatio=1;
    addTearDown(t.view.resetPhysicalSize);addTearDown(t.view.resetDevicePixelRatio);
    final f=RefundFixture();final a=await mountRefund(t,f,scale:2);
    await pressRefund(t,'refund-capsule-$firstCapsule');await pressRefund(t,'refund-quote');
    await revealRefund(t, 'refund-submit');
    expect(t.takeException(),isNull);await unmountRefund(t,a,f);
  });
  testWidgets('history handles empty records without fabricated samples', (t)async {
    final f=RefundFixture()..history=[];final a=await mountRefund(t,f,history:true);
    expect(find.text('구매한 주문이 없습니다.'),findsOneWidget);expect(find.text('합성 시험 박스'),findsNothing);
    expect(f.mutations,isEmpty);await unmountRefund(t,a,f);
  });
}

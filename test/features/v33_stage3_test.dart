import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_flow.dart';
import 'package:gacha_vault/core/config/app_config.dart';
import '../../tool/v33_stage3/fixtures.dart';
import '../support/closure_fixture.dart';
import '../support/refund_fixture.dart';

Future<void> mount(
  WidgetTester t,
  Stage3Fixture f,
  String name, {
  double width = 390,
  double scale = 1,
  double height = 844,
  bool settle = true,
  double keyboard = 0,
}) async {
  t.view.physicalSize = Size(width, height);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  addTearDown(t.view.resetDevicePixelRatio);
  await t.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: f.authFor(name)),
        ChangeNotifierProvider(create: (_) => GpProvider(initialBalance: 1000)),
      ],
      child: MaterialApp(
        key: UniqueKey(),
        theme: GachiTheme.data,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(scale),
            padding: const EdgeInsets.only(top: 44, bottom: 34),
            viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
            viewInsets: EdgeInsets.only(bottom: keyboard),
          ),
          child: child!,
        ),
        home: RepaintBoundary(
          key: const ValueKey('stage3-capture'),
          child: f.page(name),
        ),
      ),
    ),
  );
  if (settle) {
    await t.pumpAndSettle();
  } else {
    await t.pump();
    await t.pump();
  }
}

Future<void> close(WidgetTester t, Stage3Fixture f) async {
  await t.pumpWidget(const SizedBox.shrink());
  await t.pump();
  f.dispose();
}

Future<void> inspectScroll(WidgetTester t) async {
  final positions = t
      .stateList<ScrollableState>(find.byType(Scrollable))
      .map((s) => s.position)
      .toList();
  for (final p in positions) {
    if (p.axis != Axis.vertical || !p.hasContentDimensions) continue;
    for (var i = 0; i < 8 && p.pixels < p.maxScrollExtent; i++) {
      p.jumpTo((p.pixels + 350).clamp(0, p.maxScrollExtent));
      await t.pumpAndSettle();
      expect(t.takeException(), isNull);
    }
  }
}

Future<void> capture(WidgetTester t, String name) async {
  final boundary = t.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('stage3-capture')),
  );
  await t.runAsync(() async {
    final image = await boundary.toImage();
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    final f = File('build/ui-previews/v33-stage3-$name.png');
    await f.parent.create(recursive: true);
    await f.writeAsBytes(data!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  setUpAll(() async {
    final loader = FontLoader('Pretendard')
      ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'));
    await loader.load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0]) {
      for (final name in stage3Screens) {
        testWidgets(
          '$name ${width.toInt()} ${scale * 100}% preserves readable scrollable UI',
          (t) async {
            final f = Stage3Fixture(long: true);
            await f.initialize();
            await mount(t, f, name, width: width, scale: scale);
            expect(find.byType(GachiFlowScaffold), findsOneWidget);
            expect(t.takeException(), isNull);
            if ((width == 390 && scale == 1 || width == 320 && scale == 2) &&
                [
                  'orders',
                  'refund',
                  'shipping',
                  'security',
                  'closure',
                  'conversion',
                  'support_compose',
                  'reset',
                ].contains(name)) {
              await capture(t, '$name-${width.toInt()}-${scale.toInt()}x');
            }
            await inspectScroll(t);
            expect(
              f.requests.where(
                (r) => r.method == 'POST' && !r.url.path.endsWith('/quote'),
              ),
              isEmpty,
            );
            expect(f.refund.mutations, isEmpty);
            expect(f.closure.posts, isEmpty);
            await close(t, f);
          },
        );
      }
    }
  }
  for (final name in [
    'security',
    'reset',
    'closure',
    'support_compose',
    'shipping_detail',
    'conversion',
    'login',
    'signup',
  ]) {
    testWidgets('$name landscape 200% keyboard and safe area', (t) async {
      final f = Stage3Fixture(long: true);
      await f.initialize();
      await mount(t, f, name, width: 844, height: 390, scale: 2, keyboard: 140);
      expect(t.takeException(), isNull);
      await inspectScroll(t);
      await close(t, f);
    });
  }
  for (final name in [
    'orders',
    'shipping',
    'conversion_history',
    'support',
    'point_history',
  ]) {
    testWidgets('$name empty list stays truthful', (t) async {
      final f = Stage3Fixture()..empty = true;
      f.refund.history = [];
      await f.initialize();
      await mount(t, f, name, width: 320, scale: 2);
      expect(t.takeException(), isNull);
      expect(find.textContaining('없'), findsWidgets);
      await close(t, f);
    });
  }
  testWidgets(
    'order detail keeps currency units server status and disabled refund gate',
    (t) async {
      final f = Stage3Fixture();
      await f.initialize();
      f.refund.enabled = false;
      await mount(t, f, 'refund');
      expect(find.text('300 GP'), findsOneWidget);
      expect(find.text('구매 완료'), findsOneWidget);
      expect(
        t
            .widget<OutlinedButton>(find.byKey(const Key('refund-quote')))
            .onPressed,
        isNull,
      );
      expect(f.refund.mutations, isEmpty);
      await close(t, f);
    },
  );
  testWidgets(
    'refund processing and unknown receipt never become a completed refund',
    (t) async {
      final f = Stage3Fixture();
      await f.initialize();
      f.refund.receipt = {
        'refundId': refundId,
        'orderId': orderId,
        'capsuleIds': [firstCapsule],
        'quantity': 1,
        'amount': 100,
        'currency': 'KRW',
        'status': 'UNKNOWN',
        'reason': '합성 사유',
        'balanceAfter': null,
        'createdAt': '2026-09-20T09:00:00Z',
        'completedAt': null,
      };
      await mount(t, f, 'orders');
      await t.tap(find.text('환불 내역'));
      await t.pumpAndSettle();
      expect(find.text('결제사 결과 확인 필요'), findsOneWidget);
      expect(find.textContaining('원결제 카드 취소'), findsOneWidget);
      expect(find.text('환불 처리 완료'), findsNothing);
      expect(f.refund.mutations, isEmpty);
      await close(t, f);
    },
  );
  testWidgets(
    'account capability loading and error preserve retry without success',
    (t) async {
      final f = Stage3Fixture();
      await f.initialize();
      final delayed = Completer<http.Response>();
      f.handler = (_) => delayed.future;
      await mount(t, f, 'security', settle: false);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      delayed.complete(reject(503, 10099));
      await t.pumpAndSettle();
      expect(find.text('다시 조회'), findsOneWidget);
      expect(find.byKey(const Key('security-change')), findsNothing);
      expect(find.textContaining('synthetic private error'), findsNothing);
      await close(t, f);
    },
  );
  testWidgets(
    'closure active request supports cancellation without claiming deletion',
    (t) async {
      final f = Stage3Fixture();
      await f.initialize();
      f.closure.row = closureRow();
      await mount(t, f, 'closure_active', width: 320, scale: 2);
      expect(find.textContaining('미개봉·환불 대기 캡슐 2개'), findsOneWidget);
      await t.ensureVisible(find.byKey(const Key('closure-cancel')));
      await t.pumpAndSettle();
      expect(find.text('요청 접수 상태입니다. 계정 삭제 완료가 아닙니다.'), findsOneWidget);
      await t.tap(find.byKey(const Key('closure-cancel')));
      await t.pumpAndSettle();
      await t.tap(find.text('돌아가기'));
      await t.pumpAndSettle();
      expect(f.closure.posts, isEmpty);
      expect(t.takeException(), isNull);
      await close(t, f);
    },
  );
  testWidgets('password fields remain obscured and clear on background', (
    t,
  ) async {
    final f = Stage3Fixture();
    await f.initialize();
    await mount(t, f, 'security', width: 320, scale: 2, keyboard: 280);
    final input = find.byKey(const Key('security-current'));
    await t.ensureVisible(input);
    await t.enterText(input, 'FixtureSecret123');
    await t.pump();
    final field = t.widget<TextFormField>(input);
    expect(field, isNotNull);
    expect(
      t
          .widget<EditableText>(
            find.descendant(of: input, matching: find.byType(EditableText)),
          )
          .obscureText,
      isTrue,
    );
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await t.pump();
    expect(
      t
          .widget<EditableText>(
            find.descendant(of: input, matching: find.byType(EditableText)),
          )
          .controller
          .text,
      isEmpty,
    );
    t.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await close(t, f);
  });
  testWidgets(
    'shipping application retains gate and fields only in opted-in debug checks',
    (t) async {
      final f = Stage3Fixture();
      await f.initialize();
      await mount(t, f, 'delivery', width: 320, scale: 2);
      if (AppConfig.shippingPreviewEnabled) {
        expect(find.byType(TextField), findsWidgets);
        await inspectScroll(t);
        expect(find.text('배송비·신청 내용 확인'), findsOneWidget);
      } else {
        expect(find.byType(TextField), findsNothing);
        expect(find.textContaining('배송 서비스를 준비'), findsOneWidget);
      }
      expect(f.requests.where((r) => r.method == 'POST'), isEmpty);
      await close(t, f);
    },
  );
}

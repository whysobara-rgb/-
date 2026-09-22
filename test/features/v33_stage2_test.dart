import 'dart:async';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:provider/provider.dart';
import 'package:gacha_vault/features/orders/order_flow_page.dart';
import 'package:gacha_vault/features/orders/batch_opening_page.dart';
import 'package:gacha_vault/features/orders/batch_result_view.dart';
import 'package:gacha_vault/features/orders/prize_reveal.dart';
import 'package:gacha_vault/features/orders/order_models.dart';
import 'package:gacha_vault/features/inventory/presentation/inventory_page.dart';
import 'package:gacha_vault/features/inventory/domain/inventory_item.dart';
import 'package:gacha_vault/features/inventory/presentation/collection_detail_page.dart';
import 'package:gacha_vault/features/profile/presentation/profile_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import 'package:gacha_vault/shared/providers/gp_provider.dart';
import 'package:gacha_vault/shared/widgets/gachi_components.dart';
import 'package:gacha_vault/shared/widgets/gachi_opening.dart';
import '../../tool/v33_stage2/fixtures.dart';

Future<void> mount(
  WidgetTester tester,
  Widget page, {
  double width = 390,
  double height = 844,
  double scale = 1,
  FixtureAuth? auth,
  bool settle = true,
  bool nav = false,
}) async {
  tester.view.physicalSize = Size(width, height);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(
          value: auth ?? FixtureAuth(),
        ),
        ChangeNotifierProvider(create: (_) => GpProvider(initialBalance: 9900)),
      ],
      child: MaterialApp(
        key: UniqueKey(),
        theme: GachiTheme.data,
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(
            textScaler: TextScaler.linear(scale),
            padding: const EdgeInsets.only(top: 44, bottom: 34),
            viewPadding: const EdgeInsets.only(top: 44, bottom: 34),
          ),
          child: child!,
        ),
        home: RepaintBoundary(
          key: const ValueKey('stage2-capture'),
          child: Scaffold(
            body: page,
            bottomNavigationBar: nav
                ? GachiBottomNavigation(selectedIndex: 3, onSelected: (_) {})
                : null,
          ),
        ),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump();
  }
}

Widget resultPage({
  int completed = 2,
  int total = 2,
  bool pending = false,
  String name = fixtureName,
}) => GachiOpeningTheme(
  child: Scaffold(
    appBar: AppBar(title: const Text('개봉 결과')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          BatchResultView(
            batch: batchFixture(
              completed: completed,
              total: total,
              pending: pending,
              name: name,
            ),
            working: false,
            continuing: false,
            grade: '전체',
            onGrade: (_) {},
            onResume: () {},
            onClose: () {},
            onCollection: () {},
          ),
        ],
      ),
    ),
  ),
);
Future<void> inspectScroll(WidgetTester tester) async {
  expect(tester.takeException(), isNull);
  final list = find.byType(ListView).first;
  for (var i = 0; i < 7; i++) {
    await tester.drag(list, const Offset(0, -430));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  }
}

Future<void> capture(WidgetTester tester, String name) async {
  final boundary = tester.renderObject<RenderRepaintBoundary>(
    find.byKey(const ValueKey('stage2-capture')),
  );
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 1);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File('build/ui-previews/stage2-$name.png');
    await file.parent.create(recursive: true);
    await file.writeAsBytes(bytes!.buffer.asUint8List());
    image.dispose();
  });
}

void main() {
  setUpAll(() async {
    final font = FontLoader('Pretendard')
      ..addFont(rootBundle.load('assets/fonts/Pretendard-Regular.otf'));
    await font.load();
    await (FontLoader(
      'MaterialIcons',
    )..addFont(rootBundle.load('fonts/MaterialIcons-Regular.otf'))).load();
  });
  for (final width in [320.0, 360.0, 390.0, 430.0]) {
    for (final scale in [1.0, 2.0]) {
      for (final screen in [
        'open',
        'result',
        'partial',
        'collection',
        'detail',
        'my',
      ]) {
        testWidgets(
          '$screen at $width and ${scale * 100}% has no clipped layout',
          (tester) async {
            final page = switch (screen) {
              'open' => OrderFlowPage(
                userId: 10,
                repository: readOnlyRepository(),
              ),
              'result' => resultPage(name: longName),
              'partial' => resultPage(
                completed: 1,
                total: 3,
                pending: true,
                name: longName,
              ),
              'collection' => InventoryPage(
                repository: FixtureInventory(
                  inventoryFixtures(count: 12, long: true),
                ),
              ),
              'detail' => CollectionDetailPage(
                item: inventoryFixtures(long: true).first,
              ),
              _ => ProfilePage(onGoToWallet: () {}),
            };
            await mount(
              tester,
              page,
              width: width,
              scale: scale,
              nav: screen == 'collection' || screen == 'my',
            );
            if (width == 390 && scale == 1 || width == 320 && scale == 2) {
              await capture(
                tester,
                '$screen-${width.toInt()}-${scale.toInt()}',
              );
            }
            await inspectScroll(tester);
          },
        );
      }
    }
  }
  testWidgets('landscape at 200 percent keeps selection actions scrollable', (
    tester,
  ) async {
    await mount(
      tester,
      OrderFlowPage(userId: 10, repository: readOnlyRepository()),
      width: 844,
      height: 390,
      scale: 2,
    );
    await tester.scrollUntilVisible(find.text('이 페이지 선택'), 120);
    await tester.tap(find.text('이 페이지 선택'));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('선택한 3개 개봉 · 0 GP'), 180);
    expect(tester.takeException(), isNull);
    await mount(
      tester,
      InventoryPage(repository: FixtureInventory(inventoryFixtures())),
      width: 844,
      height: 390,
      scale: 2,
    );
    await tester.scrollUntilVisible(find.byType(CheckboxListTile), 160);
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await mount(
      tester,
      resultPage(completed: 1, total: 3, pending: true),
      width: 844,
      height: 390,
      scale: 2,
    );
    await inspectScroll(tester);
    await mount(
      tester,
      ProfilePage(onGoToWallet: () {}),
      width: 844,
      height: 390,
      scale: 2,
    );
    await inspectScroll(tester);
  });
  testWidgets('empty vault and many inventory items remain reachable', (
    tester,
  ) async {
    await mount(
      tester,
      const InventoryPage(repository: FixtureInventory([])),
      width: 320,
      scale: 2,
    );
    await tester.scrollUntilVisible(find.text('이 상태에 해당하는 상품이 없어요'), 180);
    expect(tester.takeException(), isNull);
    await mount(
      tester,
      InventoryPage(
        repository: FixtureInventory(inventoryFixtures(count: 100)),
      ),
    );
    await tester.scrollUntilVisible(
      find.text('$fixtureName 100'),
      500,
      maxScrolls: 100,
    );
    expect(find.text('$fixtureName 100'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('all retained is unopened, without partial recovery claim', (
    tester,
  ) async {
    await mount(tester, resultPage(completed: 0, total: 3));
    expect(find.text('개봉 완료 0개'), findsOneWidget);
    expect(find.text('처리 결과 확인 중 0개'), findsOneWidget);
    expect(find.text('아직 미개봉 3개'), findsOneWidget);
    expect(find.textContaining('일부'), findsNothing);
  });
  testWidgets(
    'partial distinguishes confirmed pending and untouched capsules without IDs',
    (tester) async {
      await mount(tester, resultPage(completed: 1, total: 3, pending: true));
      expect(find.text('개봉 완료 1개'), findsOneWidget);
      expect(find.text('처리 결과 확인 중 1개'), findsOneWidget);
      expect(find.text('아직 미개봉 1개'), findsOneWidget);
      expect(find.textContaining(capsuleId(1)), findsNothing);
      expect(find.textContaining('다시 보기'), findsNothing);
    },
  );
  testWidgets(
    'neutral then confirmed presentation with repeated Skip never invents a result',
    (tester) async {
      var waiting = true;
      late StateSetter change;
      await mount(
        tester,
        GachiOpeningTheme(
          child: Scaffold(
            body: SingleChildScrollView(
              child: StatefulBuilder(
                builder: (context, setState) {
                  change = setState;
                  return GachiOpeningExperience(
                    waiting: waiting,
                    result: PrizeReveal(
                      animate: false,
                      prize: Prize(prizeData()),
                    ),
                  );
                },
              ),
            ),
          ),
        ),
        settle: false,
      );
      expect(find.text(fixtureName), findsNothing);
      expect(find.text('S'), findsNothing);
      final skip = tester
          .widget<TextButton>(find.widgetWithText(TextButton, '연출 건너뛰기'))
          .onPressed!;
      skip();
      skip();
      skip();
      await tester.pump();
      expect(find.text(fixtureName), findsNothing);
      change(() => waiting = false);
      await tester.pumpAndSettle();
      expect(find.text(fixtureName), findsOneWidget);
    },
  );
  testWidgets(
    'single open responds immediately; repeated Skip cannot repeat its POST',
    (tester) async {
      final response = Completer<http.Response>();
      var posts = 0;
      final repo = fixtureRepository((r) async {
        if (r.url.path == '/capsules') {
          return fixtureOk({
            'items': [
              {
                'id': capsuleId(1),
                'orderId': capsuleId(800),
                'sequence': 1,
                'status': 'UNOPENED',
              },
            ],
            'totalCount': 1,
            'page': 1,
            'limit': 20,
          });
        }
        if (r.url.path == '/orders/${capsuleId(800)}') {
          return fixtureOk({
            'orderId': capsuleId(800),
            'title': '테스트 박스',
            'gachaId': 1,
            'quantity': 1,
            'unitPrice': 100,
            'total': 100,
            'currency': 'GP',
            'status': 'PAID',
            'probabilityVersion': 'a' * 64,
            'capsules': [
              {
                'id': capsuleId(1),
                'orderId': capsuleId(800),
                'sequence': 1,
                'status': 'UNOPENED',
              },
            ],
          });
        }
        posts++;
        return response.future;
      });
      await mount(tester, OrderFlowPage(userId: 10, repository: repo));
      await tester.ensureVisible(find.byTooltip('박스 정보 확인'));
      await tester.tap(find.byTooltip('박스 정보 확인'));
      await tester.pumpAndSettle();
      await tester.ensureVisible(find.text('캡슐 1개 개봉하기'));
      await tester.tap(find.text('캡슐 1개 개봉하기'));
      await tester.pump();
      await tester.pump();
      expect(posts, 1);
      expect(find.text('결과를 확인하고 있어요'), findsOneWidget);
      expect(find.text(fixtureName), findsNothing);
      await tester.ensureVisible(find.text('연출 건너뛰기'));
      final skip = tester
          .widget<TextButton>(find.widgetWithText(TextButton, '연출 건너뛰기'))
          .onPressed!;
      skip();
      skip();
      await tester.pump();
      expect(posts, 1);
      response.complete(fixtureOk(openingData(1)));
      await tester.pumpAndSettle();
      expect(find.text(fixtureName), findsOneWidget);
      expect(posts, 1);
    },
  );
  testWidgets(
    'batch repeated Skip while response delayed opens each selected capsule once',
    (tester) async {
      final response = Completer<http.Response>();
      final calls = <String>[];
      final repo = fixtureRepository((r) async {
        calls.add(r.url.path);
        return calls.length == 1 ? response.future : fixtureOk(openingData(2));
      });
      await mount(
        tester,
        BatchOpeningPage(
          repository: repo,
          initialIds: [capsuleId(1), capsuleId(2)],
        ),
        settle: false,
      );
      expect(find.text(fixtureName), findsNothing);
      final skip = tester
          .widget<TextButton>(find.widgetWithText(TextButton, '연출 건너뛰기'))
          .onPressed!;
      skip();
      skip();
      skip();
      await tester.pump();
      expect(calls.length, 1);
      response.complete(fixtureOk(openingData(1)));
      await tester.pumpAndSettle();
      expect(calls, [
        '/capsules/${capsuleId(1)}/open',
        '/capsules/${capsuleId(2)}/open',
      ]);
      expect(find.text('2개 개봉 완료'), findsOneWidget);
      expect(find.text('× 2'), findsOneWidget);
    },
  );
  testWidgets(
    'lost response recovery reads stored result before opening next capsule',
    (tester) async {
      final store = FixtureStore();
      final lost = fixtureRepository(
        (r) async => throw http.ClientException('lost'),
        store: store,
      );
      await lost.startBatch([capsuleId(1), capsuleId(2)]);
      try {
        await lost.advanceBatch();
      } catch (_) {}
      final calls = <String>[];
      final repo = fixtureRepository((r) async {
        calls.add('${r.method} ${r.url.path}');
        return fixtureOk(openingData(r.method == 'GET' ? 1 : 2));
      }, store: store);
      await mount(tester, BatchOpeningPage(repository: repo));
      expect(find.text('처리 결과 확인 중 1개'), findsOneWidget);
      expect(find.text('아직 미개봉 1개'), findsOneWidget);
      await tester.ensureVisible(find.text('처리 중인 결과 확인 후 이어가기'));
      await tester.tap(find.text('처리 중인 결과 확인 후 이어가기'));
      await tester.pumpAndSettle();
      expect(calls, [
        'GET /capsules/${capsuleId(1)}/result',
        'POST /capsules/${capsuleId(2)}/open',
      ]);
      expect(find.text('2개 개봉 완료'), findsOneWidget);
    },
  );
  testWidgets('dispose and late response cannot advance batch or navigate', (
    tester,
  ) async {
    final response = Completer<http.Response>();
    var calls = 0;
    final repo = fixtureRepository((r) {
      calls++;
      return response.future;
    });
    await mount(
      tester,
      BatchOpeningPage(
        repository: repo,
        initialIds: [capsuleId(1), capsuleId(2)],
      ),
      settle: false,
    );
    await tester.pumpWidget(const MaterialApp(home: Text('다른 화면')));
    response.complete(fixtureOk(openingData(1)));
    await tester.pumpAndSettle();
    expect(calls, 1);
    expect(find.text('다른 화면'), findsOneWidget);
    expect((await repo.pendingBatch())!.remaining, 1);
    expect(tester.takeException(), isNull);
  });
  testWidgets(
    'background resume never dispatches a fresh open; remaining requires existing resume action',
    (tester) async {
      final response = Completer<http.Response>();
      var calls = 0;
      final repo = fixtureRepository((r) {
        calls++;
        return response.future;
      });
      await mount(
        tester,
        BatchOpeningPage(
          repository: repo,
          initialIds: [capsuleId(1), capsuleId(2)],
        ),
        settle: false,
      );
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      response.complete(fixtureOk(openingData(1)));
      await tester.pump();
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(find.text('남은 박스 이어서 개봉'), findsOneWidget);
      expect(find.text('아직 미개봉 1개'), findsOneWidget);
    },
  );
  testWidgets(
    'account switch hides late confirmed result and stops further opening',
    (tester) async {
      final response = Completer<http.Response>();
      var calls = 0;
      final auth = FixtureAuth();
      final repo = fixtureRepository((r) {
        calls++;
        return response.future;
      }, auth: auth);
      await mount(
        tester,
        BatchOpeningPage(
          repository: repo,
          initialIds: [capsuleId(1), capsuleId(2)],
        ),
        auth: auth,
        settle: false,
      );
      auth.switchAccount(11);
      await tester.pump();
      response.complete(fixtureOk(openingData(1)));
      await tester.pumpAndSettle();
      expect(calls, 1);
      expect(find.text(fixtureName), findsNothing);
      expect(find.text('구매한 계정으로 다시 로그인해주세요.'), findsOneWidget);
    },
  );
  testWidgets(
    'reduce motion gives confirmed result immediately and semantics announce it',
    (tester) async {
      await mount(
        tester,
        MediaQuery(
          data: const MediaQueryData(disableAnimations: true),
          child: GachiOpeningExperience(
            waiting: false,
            result: const Text('확정 결과'),
          ),
        ),
        settle: false,
      );
      expect(find.text('확정 결과'), findsOneWidget);
      final semantics = tester.widgetList<Semantics>(find.byType(Semantics));
      expect(semantics.any((s) => s.properties.liveRegion == true), isTrue);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'result photo loading and failure preserve name and collection access',
    (tester) async {
      const url = 'https://stage2.invalid/failed-photo.png';
      final frame = Completer<ImageInfo>();
      PaintingBinding.instance.imageCache.putIfAbsent(
        const NetworkImage(url),
        () => OneFrameImageStreamCompleter(frame.future),
      );
      var opened = 0;
      await mount(
        tester,
        GachiOpeningTheme(
          child: Scaffold(
            body: ListView(
              children: [
                PrizeReveal(
                  animate: false,
                  prize: Prize(prizeData(name: longName, image: url)),
                ),
                GachiPrimaryButton(label: '보관함 보기', onPressed: () => opened++),
              ],
            ),
          ),
        ),
        width: 320,
        scale: 2,
        settle: false,
      );
      final before = tester.getSize(find.byType(GachiProductImage));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      frame.completeError(StateError('Controlled photo failure'));
      await tester.pumpAndSettle();
      expect(find.text('사진을 불러오지 못했어요'), findsOneWidget);
      expect(tester.getSize(find.byType(GachiProductImage)), before);
      expect(find.text(longName), findsOneWidget);
      await tester.ensureVisible(find.text('보관함 보기'));
      await tester.tap(find.text('보관함 보기'));
      expect(opened, 1);
      expect(tester.takeException(), isNull);
      await tester.pumpWidget(const SizedBox());
      PaintingBinding.instance.imageCache.clear();
    },
  );
  testWidgets(
    'inventory loading error and retry retain the same read contract',
    (tester) async {
      final repository = _DeferredInventory();
      await mount(tester, InventoryPage(repository: repository), settle: false);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      repository.reply.completeError(StateError('offline'));
      await tester.pumpAndSettle();
      expect(find.text('보관함 목록을 불러오지 못했습니다'), findsOneWidget);
      repository.reply = Completer();
      await tester.tap(find.text('다시 시도'));
      await tester.pump();
      repository.reply.complete(inventoryFixtures());
      await tester.pumpAndSettle();
      expect(find.text('$fixtureName 1'), findsOneWidget);
      expect(repository.reads, 2);
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'My retains all commerce account and logout entrypoints with wallet action',
    (tester) async {
      var wallet = 0;
      await mount(
        tester,
        ProfilePage(onGoToWallet: () => wallet++),
        width: 320,
        scale: 2,
      );
      await tester.ensureVisible(find.text('GP 지갑 보기'));
      await tester.tap(find.text('GP 지갑 보기'));
      expect(wallet, 1);
      for (final label in [
        '주문·환불 내역',
        'GP 전환 · 상품 복구',
        '내 컬렉션',
        '배송 내역',
        '소식·고객지원',
        '포인트 내역',
        '계정 보안',
        '이메일 인증',
        '탈퇴 요청·상태',
      ]) {
        await tester.scrollUntilVisible(find.text(label), 160);
        expect(
          tester
              .widget<ListTile>(
                find.ancestor(
                  of: find.text(label),
                  matching: find.byType(ListTile),
                ),
              )
              .onTap,
          isNotNull,
        );
      }
      await tester.scrollUntilVisible(find.text('로그아웃'), 180);
      await tester.tap(find.text('로그아웃'));
      await tester.pumpAndSettle();
      expect(find.text('로그아웃 하시겠습니까?'), findsOneWidget);
      await tester.tap(find.text('취소'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}

class _DeferredInventory extends InventoryRepository {
  Completer<List<InventoryItem>> reply = Completer();
  int reads = 0;
  @override
  Future<List<InventoryItem>> getAll({InventoryStatus? status}) {
    reads++;
    return reply.future;
  }
}

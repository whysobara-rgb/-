// Explicit synthetic fixtures, shared by widget tests and isolated native probes.
// No live transport. Production lib/ never imports this file.
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:gacha_vault/core/network/api_client.dart';
import 'package:gacha_vault/features/account_security/account_security_page.dart';
import 'package:gacha_vault/features/account_security/account_security_repository.dart';
import 'package:gacha_vault/features/auth/presentation/login_page.dart';
import 'package:gacha_vault/features/auth/presentation/signup_page.dart';
import 'package:gacha_vault/features/closure/closure_page.dart';
import 'package:gacha_vault/features/conversions/conversion_page.dart';
import 'package:gacha_vault/features/conversions/conversion_repository.dart';
import 'package:gacha_vault/features/customer_updates/customer_content.dart';
import 'package:gacha_vault/features/customer_updates/customer_updates_page.dart';
import 'package:gacha_vault/features/customer_updates/support_repository.dart';
import 'package:gacha_vault/features/inventory/presentation/delivery_request_page.dart';
import 'package:gacha_vault/features/orders/order_repository.dart';
import 'package:gacha_vault/features/recovery/recovery_page.dart';
import 'package:gacha_vault/features/refunds/order_history_page.dart';
import 'package:gacha_vault/features/shipping/domain/shipping_request.dart';
import 'package:gacha_vault/features/shipping/fulfillment_repository.dart';
import 'package:gacha_vault/features/shipping/presentation/shipping_history_page.dart';
import 'package:gacha_vault/features/wallet/domain/point_history.dart';
import 'package:gacha_vault/features/wallet/presentation/point_history_page.dart';
import 'package:gacha_vault/features/wallet/presentation/wallet_page.dart';
import 'package:gacha_vault/shared/providers/auth_provider.dart';
import '../../test/support/closure_fixture.dart';
import '../../test/support/recovery_fixture.dart';
import '../../test/support/refund_fixture.dart';
import '../v33_stage2/fixtures.dart' show prizeData, inventoryFixtures;

const productName = '취향을 담은 컬렉션 박스';
const longProductName = '오래도록 간직하고 싶은 컬렉션 상품과 특별한 구성품 전체가 포함된 긴 상품명';
const shippingId = '55555555-5555-4555-8555-555555555555';
const conversionId = '66666666-6666-4666-8666-666666666666';
const ticketId = '77777777-7777-4777-8777-777777777777';
const recipient = {
  'name': '김가치 (합성)',
  'phone': '01000000000',
  'postalCode': '00000',
  'address1': '합성시 테스트구 디자인로 123, 긴 주소의 동과 건물명을 함께 확인합니다',
  'address2': '가치가차 테스트동 1234호 (실제 주소 아님)',
  'notes': '합성 배송 요청입니다.',
  'country': 'KR',
};
Map<String, dynamic> shippingData({
  bool long = false,
  String status = 'SHIPPING',
}) => {
  'fulfillmentId': shippingId,
  'recipient': recipient,
  'feeGP': 3000,
  'status': status,
  'createdAt': '2026-09-20T09:00:00Z',
  'items': [
    {
      'inventoryItemId': 1,
      'prize': {'name': long ? longProductName : productName},
    },
  ],
  'carrier': null,
  'trackingNumber': null,
};
Map<String, dynamic> conversionPolicy() => {
  'version': 1,
  'normalRate': 10,
  'premiumRate': 100,
  'restoreHours': 24,
  'maxRestoresPerItem': 1,
  'restoreRule': 'NO_GP_SPEND_SINCE_CONVERSION',
};
Map<String, dynamic> conversionItem({bool long = false}) => {
  'inventoryItemId': 1,
  'prize': prizeData(name: long ? longProductName : productName),
  'amountGP': 100,
};
Map<String, dynamic> conversionReceipt({bool long = false}) => {
  'conversionId': conversionId,
  'totalGP': 100,
  'balanceAfter': 1100,
  'restoredBalanceAfter': null,
  'status': 'CONVERTED',
  'createdAt': '2026-09-20T09:00:00Z',
  'restoreUntil': '2026-09-21T09:00:00Z',
  'policy': conversionPolicy(),
  'items': [conversionItem(long: long)],
  'canRestore': false,
  'restoreReason': '복구 가능 기한이 지났습니다.',
};

class Stage3Fixture {
  final refund = RefundFixture();
  final closure = ClosureFixture();
  final recovery = RecoveryFixture();
  final reset = RecoveryFixture();
  final store = RefundStore();
  final token = RefundToken();
  late final http.Client client;
  late final ApiClient api;
  late final AuthProvider auth;
  bool long = false, empty = false, fail = false;
  Future<http.Response> Function(http.Request)? handler;
  final requests = <http.Request>[];
  Stage3Fixture({this.long = false}) {
    refund.data['title'] = long ? longProductName : productName;
    client = MockClient((r) async {
      requests.add(r);
      if (handler != null) return handler!(r);
      if (fail) throw http.ClientException('fixture connection unavailable');
      switch (r.url.path) {
        case '/users/me':
          return response({
            'id': 1,
            'email': 'synthetic@example.invalid',
            'nickname': '가치가차 합성 계정',
            'coinBalance': 1000,
          });
        case '/account/capabilities':
          return response(closureCaps);
        case '/fulfillments':
          return response(_page(r, empty ? [] : [shippingData(long: long)]));
        case '/fulfillments/$shippingId':
          return response(shippingData(long: long));
        case '/inventory-conversions':
          return response(
            _page(r, empty ? [] : [conversionReceipt(long: long)]),
          );
        case '/inventory-conversions/$conversionId':
          return response(conversionReceipt(long: long));
        case '/inventory-conversions/capabilities':
          return response({
            'enabled': true,
            'contract': 'INVENTORY_CONVERSION_V1',
          });
        case '/inventory-conversions/quote':
          return response({
            'totalGP': 100,
            'balance': 1000,
            'quoteVersion': 'a' * 64,
            'policy': conversionPolicy(),
            'entries': [conversionItem(long: long)],
            'restoreEligible': true,
          });
        case '/wallet/point-history':
          return response(
            _page(
              r,
              empty
                  ? []
                  : [
                      {
                        'id': 1,
                        'description': long ? longProductName : '상품 GP 전환',
                        'type': 'EARN',
                        'amount': 100,
                        'createdAt': '2026-09-20T09:00:00Z',
                      },
                    ],
            ),
          );
        case '/support/tickets':
          return response(
            _page(
              r,
              empty
                  ? []
                  : [
                      {
                        'ticketId': ticketId,
                        'subject': '배송 진행 상태를 확인하고 싶어요',
                        'status': 'OPEN',
                      },
                    ],
            ),
          );
        case '/support/tickets/$ticketId':
          return response({
            'ticket': {
              'ticketId': ticketId,
              'subject': '배송 진행 상태 문의',
              'status': 'OPEN',
              'orderId': orderId,
            },
            'messages': [
              {
                'messageId': shippingId,
                'sequence': 1,
                'authorRole': 'CUSTOMER',
                'body': '배송 주소와 진행 상태를 확인하고 싶어요. 이 대화는 UI 검증용 합성 자료입니다.',
              },
            ],
            'nextAfter': 1,
            'hasMore': false,
          });
        default:
          return reject(404, 10004);
      }
    });
    api = ApiClient(
      client: client,
      tokenStorage: token,
      apiBaseUrl: 'https://stage3.example.invalid',
    );
    auth = AuthProvider(apiClient: api, tokenStorage: token);
  }
  Map<String, dynamic> _page(http.Request r, List<dynamic> rows) => {
    'items': rows,
    'totalCount': rows.length,
    'page': int.parse(r.url.queryParameters['page'] ?? '1'),
    'limit': int.parse(r.url.queryParameters['limit'] ?? '20'),
  };
  Future<void> initialize() async {
    await auth.tryAutoLogin();
    await closure.initialize();
    await recovery.initialize(signedIn: true);
    await reset.initialize();
  }

  OrderRepository get session => OrderRepository(
    api: api,
    store: store,
    userId: 1,
    server: 'https://stage3.example.invalid',
  );
  AuthProvider authFor(String name) =>
      name == 'closure' || name == 'closure_active'
      ? closure.auth
      : name == 'email'
      ? recovery.auth
      : {'reset', 'login', 'signup'}.contains(name)
      ? reset.auth
      : auth;
  Widget page(String name) => switch (name) {
    'orders' => OrderHistoryPage(repository: refund.repository()),
    'refund' => OrderRefundPage(
      orderId: orderId,
      repository: refund.repository(),
    ),
    'shipping' => ShippingHistoryPage(
      repository: ShippingRepository(apiClient: api),
    ),
    'shipping_detail' => ShippingDetailPage(
      request: ShippingRequest.fromJson(shippingData(long: long)),
      repository: ShippingRepository(apiClient: api),
    ),
    'delivery' => DeliveryRequestPage(
      items: inventoryFixtures(count: 1),
      repository: FulfillmentRepository(session),
    ),
    'conversion' => ConversionPage(
      userId: 1,
      inventoryIds: const [1],
      repository: ConversionRepository(session, enabled: true),
    ),
    'conversion_history' => ConversionPage(
      userId: 1,
      repository: ConversionRepository(session),
    ),
    'security' => AccountSecurityPage(
      repository: AccountSecurityRepository(api: api),
    ),
    'email' => RecoveryPage(verifyEmail: true, repository: recovery.repository),
    'reset' => RecoveryPage(repository: reset.repository),
    'closure' ||
    'closure_active' => AccountClosurePage(repository: closure.repository),
    'support' => CustomerUpdatesPage(
      initial: 'tickets',
      repository: CustomerContentRepository(api: api),
    ),
    'support_thread' => SupportThreadPage(
      id: ticketId,
      repository: CustomerContentRepository(api: api),
    ),
    'support_compose' => SupportComposePage(
      repository: SupportRepository(session),
    ),
    'wallet' => WalletPage(
      onGoToHome: () {},
      repository: PointHistoryRepository(apiClient: api),
    ),
    'point_history' => PointHistoryPage(
      repository: PointHistoryRepository(apiClient: api),
    ),
    'login' => const LoginPage(),
    'signup' => const SignupPage(),
    _ => throw ArgumentError(name),
  };
  void dispose() {
    refund.dispose();
    closure.dispose();
    recovery.dispose();
    reset.dispose();
    auth.dispose();
    client.close();
  }
}

const stage3Screens = [
  'orders',
  'refund',
  'shipping',
  'shipping_detail',
  'delivery',
  'conversion',
  'conversion_history',
  'security',
  'email',
  'reset',
  'closure',
  'support',
  'support_thread',
  'support_compose',
  'wallet',
  'point_history',
  'login',
  'signup',
];

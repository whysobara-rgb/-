import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../demo/backend/demo_http_client.dart';
import '../../demo/demo_config.dart';
import '../config/app_config.dart';
import 'token_storage.dart';

/// 백엔드 비즈니스 응답 코드 중 클라이언트가 분기하는 값.
class ApiCode {
  ApiCode._();

  static const int success = 10000;
  static const int validationFailed = 10001;
  static const int unauthorized = 10002;
  static const int forbidden = 10003;
  static const int notFound = 10004;
  static const int conflict = 10005;
  static const int insufficientBalance = 10006;

  /// 월 충전 한도 초과. errors[]에 "remaining:N".
  static const int topupLimitExceeded = 10007;

  /// 오늘 이미 출석함 (POST /rewards/attendance).
  static const int alreadyCheckedIn = 10008;

  /// 품절 또는 남은 수량 부족 (POST /draws). errors[]에 "remaining:N".
  static const int soldOut = 10009;

  /// 필수 약관 동의가 없음 (가입·소셜 최초 가입).
  static const int termsRequired = 10010;

  /// 같은 이메일이 다른 방식으로 가입돼 있음. errors[]에 "provider:X".
  static const int emailAlreadyRegistered = 10011;

  /// 소셜 로그인 제공자를 지금 쓸 수 없음.
  static const int socialProviderUnavailable = 10012;

  /// 배송이 진행 중이라 탈퇴할 수 없음. errors[]에 "activeShipments:N".
  static const int activeShipments = 10013;

  /// 결제 실패(카드 거절, 금액 불일치 등).
  static const int paymentFailed = 10014;

  /// 결제 미설정. (구버전 서버는 확인 중일 때도 10015에 toss:*를 붙였다.)
  static const int paymentUnavailable = 10015;

  /// 결제 승인 확인 중(토스 응답 없음). 같은 값으로 다시 부르면 된다.
  static const int paymentPending = 10016;

  /// 서버에 닿지 못함(네트워크·타임아웃). 클라이언트가 붙이는 값.
  static const int network = -1;
}

/// 백엔드 에러 응답 `{statusCode, message, errors[], url}`.
class ApiException implements Exception {
  final int statusCode;
  final String message;
  final List<String> errors;

  ApiException({
    required this.statusCode,
    required this.message,
    this.errors = const [],
  });

  /// 화면에 보여줄 한국어 한 줄 메시지.
  ///
  /// 서버 메시지는 영어로 오는 경우가 많아, 알려진 문구·코드는 우리말로
  /// 바꾸고 한글이 들어 있는 메시지만 그대로 쓴다.
  String get displayMessage {
    final known = _knownMessages[message];
    if (known != null) return known;
    if (message.startsWith('Monthly top-up limit exceeded')) {
      final remaining =
          errorInt('remaining')?.toString() ??
          RegExp(r'remaining (\d+)').firstMatch(message)?.group(1);
      return remaining == null
          ? '이번 달 충전 한도를 넘어요'
          : '이번 달 충전 한도를 넘어요. 남은 한도는 ${_comma(remaining)}원이에요';
    }
    if (message == 'Sold out') return '품절됐어요';
    final onlyLeft = RegExp(r'^Only (\d+) boxes? left').firstMatch(message);
    if (onlyLeft != null) {
      return '남은 수량이 ${_comma(onlyLeft.group(1)!)}개라 이만큼 뽑을 수 없어요';
    }
    final belowSold = RegExp(
      r'^totalStock cannot be below the (\d+) already sold',
    ).firstMatch(message);
    if (belowSold != null) {
      return '이미 판매된 ${_comma(belowSold.group(1)!)}개보다 적게 정할 수 없어요';
    }
    final badMove = RegExp(
      r'^Cannot move a (\w+) shipment to (\w+)',
    ).firstMatch(message);
    if (badMove != null) {
      return '지금 상태(${_shippingLabel(badMove.group(1)!)})에서는 '
          '${_shippingLabel(badMove.group(2)!)}(으)로 바꿀 수 없어요';
    }
    if (message.startsWith('Order is ')) return '이미 처리된 주문이에요';
    if (message.contains('not eligible for exchange')) {
      return '보관 중인 상품만 전환할 수 있어요';
    }
    if (message.contains('not eligible for shipping')) {
      return '보관 중인 상품만 배송 신청할 수 있어요';
    }
    if (message.endsWith(' login is not available right now')) {
      return '지금은 이 방법으로 로그인할 수 없어요. 잠시 후 다시 시도해 주세요';
    }
    if (_hasHangul(message)) return message;
    final byCode = _codeMessages[statusCode];
    if (byCode != null) return byCode;
    final firstHangulError = errors.where(_hasHangul).firstOrNull;
    return firstHangulError ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요';
  }

  /// errors[]의 "key:value" 항목 값. 없으면 null.
  String? errorValue(String key) {
    final prefix = '$key:';
    for (final e in errors) {
      if (e.startsWith(prefix)) return e.substring(prefix.length);
    }
    return null;
  }

  int? errorInt(String key) {
    final v = errorValue(key);
    return v == null ? null : int.tryParse(v);
  }

  /// 품절 오류의 남은 수량("remaining:N").
  int? get remainingStock => errorInt('remaining');

  /// 서버에 닿지 못해 결과를 모르는 경우(타임아웃·연결 실패).
  bool get isNetwork => statusCode == ApiCode.network;

  static bool _hasHangul(String s) => RegExp('[가-힣]').hasMatch(s);

  static String _comma(String digits) =>
      digits.replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');

  static String _shippingLabel(String code) => switch (code) {
    'REQUESTED' => '발송 대기',
    'SHIPPING' => '배송 중',
    'DELIVERED' => '배송 완료',
    _ => code,
  };

  static const Map<String, String> _knownMessages = {
    'Invalid email or password': '이메일 또는 비밀번호가 맞지 않아요',
    'Email already registered': '이미 가입된 이메일이에요',
    'This account uses social login. Please sign in with the original provider.':
        '소셜 로그인으로 가입한 계정이에요. 가입한 방법으로 로그인해 주세요',
    'Invalid social login token': '로그인 정보를 확인하지 못했어요. 다시 시도해 주세요',
    'Required agreements (terms, privacy, age 14+) are missing':
        '필수 약관에 동의해 주세요',
    'This email is already registered with another sign-in method':
        '이미 다른 방법으로 가입된 이메일이에요',
    'Insufficient balance': 'GP가 부족해요',
    'Insufficient balance for delivery fee': '배송비를 낼 GP가 부족해요',
    'Already checked in today': '오늘은 이미 출석했어요',
    'Gacha not found or inactive': '판매가 끝난 박스예요',
    'Gacha not found': '박스를 찾을 수 없어요',
    'Gacha pool is empty': '지금은 뽑을 수 있는 상품이 없어요',
    'One or more inventory items not found': '선택한 상품을 찾을 수 없어요',
    'Inventory item does not belong to the current user':
        '내 보관함의 상품만 선택할 수 있어요',
    'User not found': '회원 정보를 찾을 수 없어요. 다시 로그인해 주세요',
    'Account has shipments in progress': '배송이 끝나지 않은 신청이 있어 탈퇴할 수 없어요',
    'Payments are not configured': '지금은 충전할 수 없어요',
    'Payment is still being confirmed; retry shortly': '결제를 확인하고 있어요',
    'Amount does not match the order': '결제 금액이 주문과 달라 승인하지 않았어요',
    'Approved payment does not match the order':
        '승인된 결제가 주문과 달라 GP를 지급하지 않았어요. 고객센터로 문의해 주세요',
    'Order not found': '주문을 찾을 수 없어요',
    'Unknown package': '없는 충전 상품이에요',
    'Admin only': '운영자만 쓸 수 있어요',
    'Shipping request not found': '배송 신청을 찾을 수 없어요',
    'Banner not found': '배너를 찾을 수 없어요',
    'trackingCompany and trackingNumber are required to ship':
        '택배사와 송장번호를 입력해 주세요',
    'title is required': '제목을 입력해 주세요',
    'linkTarget must be an existing box id': '연결할 박스를 확인해 주세요',
    'linkTarget must be an https URL': 'https://로 시작하는 주소를 넣어 주세요',
    'endsAt must be after startsAt': '종료 시각은 시작 시각보다 뒤여야 해요',
  };

  static const Map<int, String> _codeMessages = {
    ApiCode.validationFailed: '입력한 내용을 다시 확인해 주세요',
    ApiCode.unauthorized: '다시 로그인해 주세요',
    ApiCode.forbidden: '이 작업을 할 수 있는 권한이 없어요',
    ApiCode.notFound: '요청한 정보를 찾을 수 없어요',
    ApiCode.conflict: '이미 처리된 요청이에요',
    ApiCode.insufficientBalance: 'GP가 부족해요',
    ApiCode.topupLimitExceeded: '이번 달 충전 한도를 넘어요',
    ApiCode.alreadyCheckedIn: '오늘은 이미 출석했어요',
    ApiCode.soldOut: '남은 수량이 부족해요',
    ApiCode.termsRequired: '필수 약관에 동의해 주세요',
    ApiCode.emailAlreadyRegistered: '이미 다른 방법으로 가입된 이메일이에요',
    ApiCode.socialProviderUnavailable: '지금은 이 방법으로 로그인할 수 없어요',
    ApiCode.activeShipments: '배송이 끝나지 않은 신청이 있어 탈퇴할 수 없어요',
    ApiCode.paymentFailed: '결제하지 못했어요',
    ApiCode.paymentUnavailable: '지금은 충전할 수 없어요',
    ApiCode.paymentPending: '결제를 확인하고 있어요',
  };

  @override
  String toString() => message;
}

/// 백엔드 REST 공용 클라이언트.
///
/// - 서버 주소는 빌드 시 `--dart-define=API_BASE_URL=...`로 주입한다.
/// - 성공 응답 `{statusCode:10000, message, data}`는 `data`만 돌려주고,
///   그 밖의 응답은 [ApiException]으로 던진다.
/// - 테스트는 `httpClient`에 `package:http/testing.dart`의 MockClient를 넣는다.
/// - `--dart-define=DEMO_MODE=true`면 모든 요청이 [DemoHttpClient]로 간다.
class ApiClient {
  static const String baseUrl = AppConfig.apiBaseUrl;

  static const Duration _timeout = Duration(seconds: 15);

  final TokenStorage _tokenStorage;
  final http.Client? _httpClient;

  const ApiClient({
    TokenStorage tokenStorage = const TokenStorage(),
    http.Client? httpClient,
  }) : _tokenStorage = tokenStorage,
       _httpClient = httpClient;

  Future<Map<String, String>> _headers({bool withAuth = true}) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (withAuth) {
      final token = await _tokenStorage.readToken();
      if (token != null && token.isNotEmpty) {
        headers['Authorization'] = 'Bearer $token';
      }
    }
    return headers;
  }

  dynamic _unwrap(http.Response response) {
    Map<String, dynamic> body;
    try {
      body =
          jsonDecode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException(
        statusCode: response.statusCode,
        message: '서버 응답을 처리하지 못했어요 (HTTP ${response.statusCode})',
      );
    }

    final rawCode = body['statusCode'];
    final statusCode = rawCode is num ? rawCode.toInt() : response.statusCode;
    if (response.statusCode >= 200 &&
        response.statusCode < 300 &&
        statusCode == ApiCode.success) {
      return body['data'];
    }

    final message = body['message']?.toString() ?? '알 수 없는 오류가 발생했어요';
    final errorsRaw = body['errors'];
    final errors = errorsRaw is List
        ? errorsRaw.map((e) => e.toString()).toList()
        : <String>[];
    throw ApiException(
      statusCode: statusCode,
      message: message,
      errors: errors,
    );
  }

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) async {
    final headers = await _headers(withAuth: withAuth);
    final request = http.Request(method, Uri.parse('$baseUrl$path'))
      ..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);
    // 체험판(DEMO_MODE)은 네트워크 대신 브라우저 안의 DemoBackend로 보낸다.
    // 플래그가 꺼진 빌드에서는 상수 false라 이 분기가 컴파일 단계에서 빠진다.
    final client =
        _httpClient ??
        (DemoConfig.enabled ? DemoHttpClient.instance : http.Client());
    try {
      final streamed = await client.send(request).timeout(_timeout);
      final response = await http.Response.fromStream(
        streamed,
      ).timeout(_timeout);
      return _unwrap(response);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(
        statusCode: ApiCode.network,
        message: '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요',
      );
    } catch (_) {
      throw ApiException(
        statusCode: ApiCode.network,
        message: '서버에 연결하지 못했어요. 네트워크를 확인해 주세요',
      );
    } finally {
      // 주입받은 클라이언트는 호출한 쪽이 닫는다.
      if (_httpClient == null) client.close();
    }
  }

  Future<dynamic> get(String path, {bool withAuth = true}) =>
      _send('GET', path, withAuth: withAuth);

  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) => _send('POST', path, body: body, withAuth: withAuth);

  Future<dynamic> put(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) => _send('PUT', path, body: body, withAuth: withAuth);

  Future<dynamic> patch(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) => _send('PATCH', path, body: body, withAuth: withAuth);

  Future<dynamic> delete(String path, {bool withAuth = true}) =>
      _send('DELETE', path, withAuth: withAuth);
}

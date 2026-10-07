import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'token_storage.dart';

/// 백엔드 비즈니스 응답 코드 중 클라이언트가 분기하는 값.
class ApiCode {
  ApiCode._();

  static const int success = 10000;
  static const int unauthorized = 10002;
  static const int insufficientBalance = 10006;

  /// 월 충전 한도 초과 (POST /wallet/topup).
  static const int topupLimitExceeded = 10007;

  /// 오늘 이미 출석함 (POST /rewards/attendance).
  static const int alreadyCheckedIn = 10008;

  /// 품절 또는 남은 수량 부족 (POST /draws). errors[]에 "remaining:N".
  static const int soldOut = 10009;
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
      final remaining = RegExp(
        r'remaining (\d+)',
      ).firstMatch(message)?.group(1);
      return remaining == null
          ? '이번 달 충전 한도를 넘어요'
          : '이번 달 충전 한도를 넘어요. 남은 한도는 ${_comma(remaining)}원이에요';
    }
    if (message == 'Sold out') return '품절됐어요';
    final onlyLeft = RegExp(r'^Only (\d+) boxes? left').firstMatch(message);
    if (onlyLeft != null) {
      return '남은 수량이 ${_comma(onlyLeft.group(1)!)}개라 이만큼 뽑을 수 없어요';
    }
    if (message.contains('not eligible for exchange')) {
      return '보관 중인 상품만 전환할 수 있어요';
    }
    if (message.contains('not eligible for shipping')) {
      return '보관 중인 상품만 배송 신청할 수 있어요';
    }
    if (_hasHangul(message)) return message;
    final byCode = _codeMessages[statusCode];
    if (byCode != null) return byCode;
    final firstHangulError = errors.where(_hasHangul).firstOrNull;
    return firstHangulError ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요';
  }

  static bool _hasHangul(String s) => RegExp('[가-힣]').hasMatch(s);

  static String _comma(String digits) =>
      digits.replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+$)'), (m) => '${m[1]},');

  static const Map<String, String> _knownMessages = {
    'Invalid email or password': '이메일 또는 비밀번호가 맞지 않아요',
    'Email already registered': '이미 가입된 이메일이에요',
    'This account uses social login. Please sign in with the original provider.':
        '소셜 로그인으로 가입한 계정이에요. 가입한 방법으로 로그인해 주세요',
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
  };

  static const Map<int, String> _codeMessages = {
    10001: '입력한 내용을 다시 확인해 주세요',
    ApiCode.unauthorized: '다시 로그인해 주세요',
    10003: '이 작업을 할 수 있는 권한이 없어요',
    10004: '요청한 정보를 찾을 수 없어요',
    10005: '이미 처리된 요청이에요',
    ApiCode.insufficientBalance: 'GP가 부족해요',
    ApiCode.topupLimitExceeded: '이번 달 충전 한도를 넘어요',
    ApiCode.alreadyCheckedIn: '오늘은 이미 출석했어요',
    ApiCode.soldOut: '남은 수량이 부족해요',
  };

  /// 품절 오류의 남은 수량("remaining:N").
  int? get remainingStock {
    for (final e in errors) {
      final m = RegExp(r'remaining:(\d+)').firstMatch(e);
      if (m != null) return int.tryParse(m.group(1)!);
    }
    return null;
  }

  @override
  String toString() => message;
}

/// 백엔드 REST 공용 클라이언트.
///
/// - 서버 주소는 빌드 시 `--dart-define=API_BASE_URL=...`로 주입한다.
/// - 성공 응답 `{statusCode:10000, message, data}`는 `data`만 돌려주고,
///   그 밖의 응답은 [ApiException]으로 던진다.
class ApiClient {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000',
  );

  static const Duration _timeout = Duration(seconds: 15);

  final TokenStorage _tokenStorage;

  const ApiClient({TokenStorage tokenStorage = const TokenStorage()})
    : _tokenStorage = tokenStorage;

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

  Future<dynamic> _send(Future<http.Response> Function() request) async {
    try {
      final response = await request().timeout(_timeout);
      return _unwrap(response);
    } on ApiException {
      rethrow;
    } on TimeoutException {
      throw ApiException(
        statusCode: -1,
        message: '서버 응답이 늦어요. 잠시 후 다시 시도해 주세요',
      );
    } catch (_) {
      throw ApiException(
        statusCode: -1,
        message: '서버에 연결하지 못했어요. 네트워크를 확인해 주세요',
      );
    }
  }

  Uri _uri(String path) => Uri.parse('$baseUrl$path');

  Future<dynamic> get(String path, {bool withAuth = true}) async {
    final headers = await _headers(withAuth: withAuth);
    return _send(() => http.get(_uri(path), headers: headers));
  }

  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) async {
    final headers = await _headers(withAuth: withAuth);
    return _send(
      () => http.post(
        _uri(path),
        headers: headers,
        body: body != null ? jsonEncode(body) : null,
      ),
    );
  }

  Future<dynamic> put(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) async {
    final headers = await _headers(withAuth: withAuth);
    return _send(
      () => http.put(
        _uri(path),
        headers: headers,
        body: body != null ? jsonEncode(body) : null,
      ),
    );
  }
}

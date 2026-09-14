import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import 'token_storage.dart';

/// 가치가차 - 백엔드(NestJS) 공용 응답 포맷을 처리하는 예외 클래스.
///
/// 백엔드 에러 응답 포맷: {statusCode, message, errors[], url}
class ApiException implements Exception {
  final int statusCode;
  final String message;
  final List<String> errors;
  final int? httpStatusCode;

  ApiException({
    required this.statusCode,
    required this.message,
    this.errors = const [],
    this.httpStatusCode,
  });

  @override
  String toString() => message;
}

/// 가치가차 - 백엔드 REST API 공용 HTTP 클라이언트.
///
/// - baseUrl: 백엔드 서버 주소 (샌드박스 환경에서는 GetServiceUrl로 발급된 URL)
/// - 모든 요청에 Authorization: Bearer 토큰 헤더를 자동으로 첨부
/// - 백엔드 공용 응답 포맷( {statusCode,message,data} 성공 /
///   {statusCode,message,errors[],url} 실패 )을 언래핑하여
///   성공 시 data를, 실패 시 ApiException을 throw 한다.
class ApiClient {
  static const String baseUrl = AppConfig.apiBaseUrl;

  final TokenStorage _tokenStorage;
  final http.Client? _client;
  final String _baseUrl;
  final Duration _timeout;

  const ApiClient({
    TokenStorage tokenStorage = const TokenStorage(),
    http.Client? client,
    String apiBaseUrl = baseUrl,
    Duration timeout = const Duration(seconds: 20),
  }) : _tokenStorage = tokenStorage,
       _client = client,
       _baseUrl = apiBaseUrl,
       _timeout = timeout;

  bool _hasUnsafePath(String path) {
    try {
      return path.split('?').first.split('/').any((raw) {
        final segment = Uri.decodeComponent(raw);
        return segment == '.' ||
            segment == '..' ||
            segment.contains('/') ||
            segment.contains('\\');
      });
    } on FormatException {
      return true;
    }
  }

  Uri _uri(String path) {
    final base = Uri.tryParse(_baseUrl);
    final relative = Uri.tryParse(path);
    if (_hasUnsafePath(path) ||
        base == null ||
        base.scheme != 'https' ||
        base.host.isEmpty ||
        base.userInfo.isNotEmpty ||
        base.hasQuery ||
        base.hasFragment ||
        relative == null ||
        !path.startsWith('/') ||
        path.startsWith('//') ||
        relative.hasScheme ||
        relative.hasAuthority ||
        relative.hasFragment ||
        relative.pathSegments.any((segment) => segment == '..')) {
      throw ApiException(statusCode: 0, message: '서비스 연결 설정을 확인해주세요');
    }
    return Uri.parse('${_baseUrl.replaceFirst(RegExp(r'/+$'), '')}$path');
  }

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
    if (response.statusCode == 204) return null;
    Map<String, dynamic> body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException(
        statusCode: response.statusCode,
        httpStatusCode: response.statusCode,
        message: '서버 응답을 처리할 수 없습니다 (HTTP ${response.statusCode})',
      );
    }

    final statusCode = body['statusCode'] is int
        ? body['statusCode'] as int
        : response.statusCode;
    // 백엔드 ResponseCode: 10000 = SUCCESS, 그 외는 에러로 취급.
    if (response.statusCode >= 200 &&
        response.statusCode < 300 &&
        statusCode == 10000) {
      return body['data'];
    }

    final rawMessage = body['message'];
    final message = rawMessage is String
        ? rawMessage
        : rawMessage is List
        ? rawMessage.join('\n')
        : '요청을 처리하지 못했습니다';
    final errorsRaw = body['errors'];
    final errors = (errorsRaw is List)
        ? errorsRaw.map((e) => e.toString()).toList()
        : <String>[];
    throw ApiException(
      statusCode: statusCode,
      httpStatusCode: response.statusCode,
      message: message,
      errors: errors,
    );
  }

  Future<dynamic> get(String path, {bool withAuth = true}) async {
    return _request('GET', path, withAuth: withAuth);
  }

  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) async {
    if (path.split('?').first == '/wallet/topup') {
      throw ApiException(statusCode: 0, message: 'GP는 별도로 충전할 수 없습니다');
    }
    if (!AppConfig.legacyTransactionsEnabled &&
        {'/draws', '/shipping-requests'}.contains(path.split('?').first)) {
      throw ApiException(statusCode: 0, message: '현재 서비스를 준비하고 있습니다');
    }
    return _request('POST', path, body: body, withAuth: withAuth);
  }

  Future<dynamic> put(String path, {required Map<String, dynamic> body}) {
    return _request('PUT', path, body: body, withAuth: true);
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    required bool withAuth,
  }) async {
    final uri = _uri(path);
    final client = _client ?? http.Client();
    try {
      final headers = await _headers(withAuth: withAuth);
      // Mutations are never automatically retried: a lost response does not
      // prove the server rejected the operation.
      final response =
          await (method == 'GET'
                  ? client.get(uri, headers: headers)
                  : (method == 'PUT' ? client.put : client.post)(
                      uri,
                      headers: headers,
                      body: body == null ? null : jsonEncode(body),
                    ))
              .timeout(_timeout);
      return _unwrap(response);
    } on TimeoutException {
      throw ApiException(
        statusCode: 0,
        message: method == 'GET'
            ? '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요'
            : '처리 결과를 확인하지 못했습니다. 이용 내역을 확인해주세요',
      );
    } on http.ClientException {
      throw ApiException(
        statusCode: 0,
        message: method == 'GET'
            ? '네트워크 연결을 확인해주세요'
            : '처리 결과를 확인하지 못했습니다. 이용 내역을 확인해주세요',
      );
    } finally {
      if (_client == null) client.close();
    }
  }
}

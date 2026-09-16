import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import '../config/app_config.dart';
import 'token_storage.dart';

/// Backend failures, without retaining a request body or credentials.
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

class ApiSessionChangedException extends ApiException {
  ApiSessionChangedException()
    : super(statusCode: 0, message: '로그인 상태가 바뀌었습니다. 다시 확인해주세요');
}

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
    final errors = errorsRaw is List
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

  void _checkPostPath(String path) {
    if (path.split('?').first == '/wallet/topup') {
      throw ApiException(statusCode: 0, message: 'GP는 별도로 충전할 수 없습니다');
    }
    if (!AppConfig.legacyTransactionsEnabled &&
        {'/draws', '/shipping-requests'}.contains(path.split('?').first)) {
      throw ApiException(statusCode: 0, message: '현재 서비스를 준비하고 있습니다');
    }
  }

  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
    String? idempotencyKey,
  }) async {
    _checkPostPath(path);
    return _request('POST', path, body: body, withAuth: withAuth,
        idempotencyKey: idempotencyKey);
  }

  Future<dynamic> put(String path, {required Map<String, dynamic> body}) {
    return _request('PUT', path, body: body, withAuth: true);
  }

  /// A lease must identify a login generation, not just a user ID.
  /// Recheck after async token reads and after responses. Already-dispatched
  /// requests cannot be undone by a later local logout.
  Future<dynamic> getForSession(String path,
      {required bool Function() sessionIsCurrent}) {
    return _request('GET', path, withAuth: true,
        sessionIsCurrent: sessionIsCurrent);
  }

  Future<dynamic> postForSession(String path,
      {required Map<String, dynamic> body,
      required bool Function() sessionIsCurrent}) async {
    _checkPostPath(path);
    return _request('POST', path, body: body, withAuth: true,
        sessionIsCurrent: sessionIsCurrent);
  }

  void _checkSession(bool Function()? current) {
    if (current == null) return;
    bool valid;
    try {
      valid = current();
    } catch (_) {
      valid = false;
    }
    if (!valid) throw ApiSessionChangedException();
  }

  Future<dynamic> _request(
    String method,
    String path, {
    Map<String, dynamic>? body,
    required bool withAuth,
    String? idempotencyKey,
    bool Function()? sessionIsCurrent,
  }) async {
    _checkSession(sessionIsCurrent);
    final uri = _uri(path);
    final client = _client ?? http.Client();
    try {
      final headers = await _headers(withAuth: withAuth);
      _checkSession(sessionIsCurrent);
      if (sessionIsCurrent != null && !headers.containsKey('Authorization')) {
        throw ApiSessionChangedException();
      }
      if (idempotencyKey != null) {
        if (!RegExp(r'^[a-f0-9-]{36}$').hasMatch(idempotencyKey)) {
          throw ApiException(statusCode: 0, message: '구매 요청을 확인해주세요');
        }
        headers['Idempotency-Key'] = idempotencyKey;
      }
      http.Response response;
      if (sessionIsCurrent != null) {
        // Sensitive account requests never follow redirects to another origin.
        final request = http.Request(method, uri)..followRedirects = false;
        request.headers.addAll(headers);
        if (body != null) request.body = jsonEncode(body);
        response = await client.send(request).then(http.Response.fromStream)
            .timeout(_timeout);
      } else {
        response = await (method == 'GET'
            ? client.get(uri, headers: headers)
            : (method == 'PUT' ? client.put : client.post)(uri,
                headers: headers, body: body == null ? null : jsonEncode(body)))
            .timeout(_timeout);
      }
      _checkSession(sessionIsCurrent);
      return _unwrap(response);
    } on TimeoutException {
      _checkSession(sessionIsCurrent);
      throw ApiException(statusCode: 0, message: method == 'GET'
          ? '서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요'
          : '처리 결과를 확인하지 못했습니다. 이용 내역을 확인해주세요');
    } on http.ClientException {
      _checkSession(sessionIsCurrent);
      throw ApiException(statusCode: 0, message: method == 'GET'
          ? '네트워크 연결을 확인해주세요'
          : '처리 결과를 확인하지 못했습니다. 이용 내역을 확인해주세요');
    } finally {
      if (_client == null) client.close();
    }
  }
}

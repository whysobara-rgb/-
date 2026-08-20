import 'dart:convert';
import 'package:http/http.dart' as http;
import 'token_storage.dart';

/// 가치가차 - 백엔드(NestJS) 공용 응답 포맷을 처리하는 예외 클래스.
///
/// 백엔드 에러 응답 포맷: {statusCode, message, errors[], url}
class ApiException implements Exception {
  final int statusCode;
  final String message;
  final List<String> errors;

  ApiException({
    required this.statusCode,
    required this.message,
    this.errors = const [],
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
  // TODO: 배포/샌드박스 환경이 바뀌면 이 baseUrl을 갱신해야 함.
  // 현재 값은 GetServiceUrl(port:3000)으로 발급받은 공개 주소.
  static const String baseUrl =
      'https://3000-i7x0zsd6jnwminn4igxd0-02b9cc79.sandbox.novita.ai';

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
      body = jsonDecode(response.body) as Map<String, dynamic>;
    } catch (_) {
      throw ApiException(
        statusCode: response.statusCode,
        message: '서버 응답을 처리할 수 없습니다 (HTTP ${response.statusCode})',
      );
    }

    final statusCode = body['statusCode'] as int? ?? response.statusCode;
    // 백엔드 ResponseCode: 10000 = SUCCESS, 그 외는 에러로 취급.
    if (response.statusCode >= 200 &&
        response.statusCode < 300 &&
        statusCode == 10000) {
      return body['data'];
    }

    final message = body['message'] as String? ?? '알 수 없는 오류가 발생했습니다';
    final errorsRaw = body['errors'];
    final errors = (errorsRaw is List)
        ? errorsRaw.map((e) => e.toString()).toList()
        : <String>[];
    throw ApiException(
      statusCode: statusCode,
      message: message,
      errors: errors,
    );
  }

  Future<dynamic> get(String path, {bool withAuth = true}) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = await http.get(
      uri,
      headers: await _headers(withAuth: withAuth),
    );
    return _unwrap(response);
  }

  Future<dynamic> post(
    String path, {
    Map<String, dynamic>? body,
    bool withAuth = true,
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    final response = await http.post(
      uri,
      headers: await _headers(withAuth: withAuth),
      body: body != null ? jsonEncode(body) : null,
    );
    return _unwrap(response);
  }
}

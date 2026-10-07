import 'dart:convert';

import 'package:http/http.dart' as http;

import 'demo_backend.dart';

/// [ApiClient]가 쓰는 http.Client 자리에 끼우는 체험판 클라이언트.
///
/// 요청을 네트워크로 보내지 않고 [DemoBackend]에 넘긴 뒤, 서버처럼 JSON
/// 본문과 HTTP 상태를 돌려준다. 그래서 ApiClient의 헤더·토큰·응답 해석
/// 경로가 실제 서버와 똑같이 돈다.
class DemoHttpClient extends http.BaseClient {
  final DemoBackend backend;

  DemoHttpClient(this.backend);

  /// 앱이 쓰는 인스턴스.
  static final DemoHttpClient instance = DemoHttpClient(DemoBackend.instance);

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final raw = request is http.Request ? request.body : '';
    final auth =
        request.headers['Authorization'] ?? request.headers['authorization'];
    final token = auth != null && auth.startsWith('Bearer ')
        ? auth.substring('Bearer '.length)
        : null;
    final url = request.url.hasQuery
        ? '${request.url.path}?${request.url.query}'
        : request.url.path;
    final response = await backend.handle(
      request.method,
      url,
      body: raw.isEmpty ? null : jsonDecode(raw),
      token: token,
    );
    final bytes = utf8.encode(jsonEncode(response.body));
    return http.StreamedResponse(
      Stream.value(bytes),
      response.httpStatus,
      contentLength: bytes.length,
      request: request,
      headers: const {'content-type': 'application/json; charset=utf-8'},
    );
  }

  /// ApiClient는 요청마다 close()를 부른다. 공유 인스턴스라 닫지 않는다.
  @override
  void close() {}
}

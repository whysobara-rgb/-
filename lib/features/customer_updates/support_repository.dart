import 'dart:convert';
import 'dart:math';
import '../../core/network/api_client.dart';
import '../orders/order_models.dart' show object, uuid;
import '../orders/order_repository.dart';

/// One durable, account-scoped request; retries use the original key and payload.
class SupportRepository {
  final OrderRepository session;
  SupportRepository(this.session);
  static final _running = <String>{};
  String get _scope => '${session.scope}_support';
  Future<Map<String, dynamic>?> pending() async {
    final raw = await session.store.read(_scope);
    if (raw == null) {
      return null;
    }
    final p = object(jsonDecode(raw));
    uuid(p['key']);
    object(p['body']);
    if (p['ticketId'] != null) {
      uuid(p['ticketId']);
    }
    return p;
  }

  Future<void> _owner() async {
    if (object(await session.api.get('/users/me'))['id'] != session.userId) {
      throw ApiException(statusCode: 401, message: '문의한 계정으로 다시 로그인해주세요');
    }
  }

  Future<T> _exclusive<T>(Future<T> Function() task) async {
    if (!_running.add(_scope)) {
      throw ApiException(statusCode: 409, message: '전송 결과를 확인하고 있습니다');
    }
    try {
      return await task();
    } finally {
      _running.remove(_scope);
    }
  }

  String _key() {
    final r = Random.secure(), b = List.generate(16, (_) => r.nextInt(256));
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }

  Future<String> send({String? ticketId, required Map<String, dynamic> body}) =>
      _exclusive(() async {
        await _owner();
        if (await pending() != null) {
          throw ApiException(statusCode: 409, message: '이전 문의의 전송 결과부터 확인해주세요');
        }
        if (ticketId != null) {
          uuid(ticketId);
        }
        final p = {'key': _key(), 'ticketId': ticketId, 'body': body};
        await session.store.write(_scope, jsonEncode(p));
        return _post(p);
      });
  Future<String> _post(Map<String, dynamic> p) async {
    try {
      final result = object(
        await session.api.post(
          p['ticketId'] == null
              ? '/support/tickets'
              : '/support/tickets/${p['ticketId']}/messages',
          body: object(p['body']),
          idempotencyKey: p['key'],
        ),
      );
      return _accept(p, result);
    } on ApiException catch (e) {
      if ([400, 404, 409, 422, 429].contains(e.httpStatusCode)) {
        await session.store.remove(_scope);
      }
      rethrow;
    }
  }

  Future<String> _accept(Map<String, dynamic> p, Map<String, dynamic> r) async {
    final id = uuid(r['ticketId']);
    if (p['ticketId'] != null &&
        (id != p['ticketId'] || r['messageId'] == null)) {
      throw ApiException(statusCode: 0, message: '전송 결과의 문의번호를 확인해주세요');
    }
    if (p['ticketId'] != null) {
      uuid(r['messageId']);
    }
    if (p['ticketId'] == null &&
        (r['subject'] != p['body']['subject'] ||
            r['orderId'] != p['body']['orderId'])) {
      throw ApiException(statusCode: 0, message: '전송 결과가 요청 내용과 일치하지 않습니다');
    }
    await session.store.remove(_scope);
    return id;
  }

  Future<String?> recover() => _exclusive(() async {
    await _owner();
    final p = await pending();
    if (p == null) {
      return null;
    }
    try {
      return await _accept(
        p,
        object(
          await session.api.get(
            p['ticketId'] == null
                ? '/support/tickets/by-request/${p['key']}'
                : '/support/messages/by-request/${p['key']}',
          ),
        ),
      );
    } on ApiException catch (e) {
      if (e.httpStatusCode != 404) {
        rethrow;
      }
      return _post(p);
    }
  });
}

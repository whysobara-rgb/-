import 'dart:convert';
import 'dart:math';
import '../../core/network/api_client.dart';
import '../account_security/account_security_repository.dart';
import '../orders/order_repository.dart';
import '../orders/order_models.dart' show uuid, invalidResponse;
import 'closure_models.dart';

class ClosureRepository {
  final ApiClient api;
  final OrderStore store;
  final int userId;
  final bool Function() sessionIsCurrent;
  final String scope;
  static final Set<String> _running = {};
  ClosureRepository({required this.api, required this.store, required this.userId,
    required String server, required this.sessionIsCurrent})
      : scope = 'closure_v1_${Uri.encodeComponent(server)}_$userId';

  void _current() {
    bool valid;
    try { valid = sessionIsCurrent(); } catch (_) { valid = false; }
    if (!valid || userId < 1) { throw ApiSessionChangedException(); }
  }
  Future<T> _exclusive<T>(Future<T> Function() action) async {
    _current();
    if (!_running.add(scope)) {
      throw ApiException(statusCode: 0, message: '이전 탈퇴 요청을 확인하고 있습니다');
    }
    try { return await action(); } finally { _running.remove(scope); }
  }
  Future<dynamic> _get(String path) => api.getForSession(path,
      sessionIsCurrent: sessionIsCurrent);
  Future<dynamic> _post(String path, Map<String, dynamic> body, {String? key}) =>
      api.postForSession(path, body: body, sessionIsCurrent: sessionIsCurrent,
          idempotencyKey: key);

  Future<bool> capabilities() async =>
      (await AccountSecurityRepository(api: api).capabilities(sessionIsCurrent)).enabled;
  Future<void> _gate() async {
    _current();
    if (!await capabilities()) {
      throw ApiException(statusCode: 0, message: '탈퇴 요청 기능을 준비하고 있습니다');
    }
  }
  Future<ClosureCheck> check() async => ClosureCheck(await _get('/account/closure-check'));
  Future<PendingClosure?> pending() async {
    _current();
    final value = await store.read(scope);
    _current();
    return value == null ? null : PendingClosure.fromJson(jsonDecode(value));
  }
  Future<void> _save(PendingClosure p) async {
    _current();
    await store.write(scope, jsonEncode(p.toJson()));
    _current();
  }
  void _matches(PendingClosure p, ClosureReceipt r) {
    if (r.reason != p.reason || (p.kind == 'cancel' && r.id != p.key)) {
      invalidResponse();
    }
  }
  Future<ClosureReceipt?> _lookup(PendingClosure p) async {
    try {
      final r = ClosureReceipt(await _get(p.kind == 'request'
          ? '/account/closure-requests/by-request/${p.key}'
          : '/account/closure-requests/${p.key}'));
      _matches(p, r);
      return r;
    } on ApiException catch (e) {
      // A missing new read-by-ID route is NOT a successful cancellation.
      if (p.kind == 'request' && e.httpStatusCode == 404 && e.statusCode == 10004) {
        return null;
      }
      rethrow;
    }
  }
  Future<ClosureReceipt?> recover() => _exclusive(() async {
    final p = await pending();
    return p == null ? null : _lookup(p);
  });
  String _key() {
    final random = Random.secure();
    final bytes = List.generate(16, (_) => random.nextInt(256));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    final h = bytes.map((v) => v.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }
  void _password(String value) {
    if (currentPasswordError(value) != null) {
      throw ApiException(statusCode: 0, message: '현재 비밀번호를 다시 입력해주세요');
    }
  }
  Future<ClosureReceipt> request(String reason, String password) => _exclusive(() async {
    _password(password);
    final normalized = closureReason(reason);
    await _gate();
    if (await pending() != null || (await check()).active != null) {
      throw ApiException(statusCode: 0, message: '기존 탈퇴 요청을 먼저 확인해주세요');
    }
    final p = PendingClosure('request', _key(), normalized);
    await _save(p);
    return _send(p, password);
  });
  Future<ClosureReceipt> cancel(ClosureActive active) => _exclusive(() async {
    await _gate();
    if (await pending() != null) {
      throw ApiException(statusCode: 0, message: '기존 처리 결과를 먼저 확인해주세요');
    }
    final p = PendingClosure('cancel', uuid(active.id), active.reason);
    final current = await _lookup(p);
    if (current == null) { invalidResponse(); }
    if (current.cancelled) { return current; }
    await _save(p);
    return _send(p, null);
  });
  Future<ClosureReceipt> retry({String? password}) => _exclusive(() async {
    await _gate();
    final p = await pending();
    if (p == null) { invalidResponse(); }
    final receipt = await _lookup(p);
    if (receipt != null && (p.kind == 'request' || receipt.cancelled)) {
      return receipt;
    }
    if (p.kind == 'request') {
      _password(password ?? '');
      if ((await check()).active != null) {
        throw ApiException(statusCode: 0, message: '다른 진행 중 요청을 먼저 확인해주세요');
      }
    }
    return _send(p, password);
  });
  Future<ClosureReceipt> _send(PendingClosure p, String? password) async {
    _current();
    final result = ClosureReceipt(await _post(p.kind == 'request'
        ? '/account/closure-requests'
        : '/account/closure-requests/${p.key}/cancel', p.kind == 'request'
        ? {'currentPassword': password, 'reason': p.reason, 'confirmation': '탈퇴 요청'}
        : {}, key: p.kind == 'request' ? p.key : null));
    _matches(p, result);
    if (p.kind == 'cancel' && !result.cancelled) { invalidResponse(); }
    return result;
  }
  /// Verify the server receipt again before the user dismisses local recovery.
  Future<void> acknowledge(ClosureReceipt displayed) => _exclusive(() async {
    final p = await pending();
    if (p == null) { return; }
    _matches(p, displayed);
    final current = await _lookup(p);
    if (current == null || current.id != displayed.id ||
        current.status != displayed.status ||
        (p.kind == 'cancel' && !current.cancelled)) { invalidResponse(); }
    _current();
    await store.remove(scope);
    _current();
  });
}

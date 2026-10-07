import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart' show rootBundle;

import '../data/catalog.dart';
import '../data/demo_state.dart';
import '../data/demo_storage.dart';
import '../demo_config.dart';
import '../engine/rules.dart';

part 'handlers_account.dart';
part 'handlers_admin.dart';
part 'handlers_catalog.dart';
part 'handlers_wallet.dart';

/// 체험판 백엔드. 앱의 모든 API 요청을 브라우저 안에서 처리한다.
///
/// 서버(gacha-vault-backend)의 서비스 코드를 옮긴 것이라 응답 모양
/// (`{statusCode:10000, message, data}` / `{statusCode, message, errors[], url}`),
/// 응답 코드, 규칙(확률·천장·10+1·재고·출석·충전 한도·첫 충전 보너스)이 같다.
/// 다른 점은 데이터가 `assets/demo/catalog.json` 스냅샷과 이 기기의
/// 저장소(localStorage)에만 있다는 것뿐이다.
///
/// 요청 하나는 메모리에서 동기적으로 끝내고 마지막에 한 번 저장한다. 그래서
/// 요청끼리 섞이지 않는다(서버의 트랜잭션 역할).
class DemoBackend {
  DemoBackend({
    required Future<DemoCatalog> Function() loadCatalog,
    required DemoStorage storage,
    Random? random,
    DateTime Function()? clock,
  }) : _loadCatalog = loadCatalog,
       _storage = storage,
       _random = random ?? Random.secure(),
       _clock = clock ?? DateTime.now;

  static DemoBackend? _instance;

  /// 앱이 쓰는 인스턴스(에셋 카탈로그 + localStorage).
  static DemoBackend get instance => _instance ??= DemoBackend(
    loadCatalog: () async => DemoCatalog.fromJsonString(
      await rootBundle.loadString(DemoConfig.catalogAsset),
    ),
    storage: PrefsDemoStorage.instance,
  );

  static const String stateKey = 'gachigacha_demo_state_v1';

  final Future<DemoCatalog> Function() _loadCatalog;
  final DemoStorage _storage;
  final Random _random;
  final DateTime Function() _clock;

  late DemoCatalog _catalog;
  late DemoState _db;
  Future<void>? _ready;
  Future<void> _saving = Future.value();

  /// 요청 하나의 시각(서버 트랜잭션의 now()처럼 요청 안에서는 같다).
  late DateTime _now;

  DemoCatalog get catalog => _catalog;

  /// 테스트용: 지금 상태.
  DemoState get state => _db;

  Future<void> ensureReady() => _ready ??= _load();

  Future<void> _load() async {
    _catalog = await _loadCatalog();
    DemoState? restored;
    try {
      final raw = await _storage.read(stateKey);
      if (raw != null) {
        final json = jsonDecode(raw) as Map<String, dynamic>;
        if (json['version'] == DemoState.schemaVersion) {
          restored = DemoState.fromJson(json);
        }
      }
    } catch (_) {
      restored = null; // 깨진 저장값은 버리고 새로 시작한다.
    }
    _db = restored ?? _seed();
    // 스냅샷이 갱신돼 새 박스가 생겼으면 판매 상태를 채운다.
    for (final g in _catalog.gachas) {
      _db.gachas.putIfAbsent(
        g['id'] as int,
        () => DemoGachaState(
          active: g['active'] as bool? ?? true,
          totalStock: (g['totalStock'] as num).toInt(),
        ),
      );
    }
    if (restored == null) await _save();
  }

  /// 처음 상태: 스냅샷 박스·배너 + 체험 계정(200,000 GP).
  DemoState _seed() {
    final now = _nowMs();
    final db = DemoState(
      banners: [for (final b in _catalog.banners) DemoBanner.fromApi(b)],
      gachas: {
        for (final g in _catalog.gachas)
          g['id'] as int: DemoGachaState(
            active: g['active'] as bool? ?? true,
            totalStock: (g['totalStock'] as num).toInt(),
          ),
      },
    );
    for (final b in db.banners) {
      db.sequences['banners'] = max(db.sequences['banners'] ?? 0, b.id);
    }
    final salt = _hex(8);
    final user = DemoUser(
      id: db.nextId('users'),
      email: DemoConfig.defaultEmail,
      passwordSalt: salt,
      passwordHash: _hashPassword(DemoConfig.defaultPassword, salt),
      nickname: DemoConfig.defaultNickname,
      coinBalance: DemoConfig.defaultBalance,
      termsAgreedAt: now,
      createdAt: now,
    );
    db.users.add(user);
    // 서버 시드가 테스트 계정에 GP를 줄 때와 같은 사유(ADJUSTMENT).
    db.ledger.add(
      DemoLedgerEntry(
        id: db.nextId('wallet_transactions'),
        userId: user.id,
        type: 'EARN',
        reason: 'ADJUSTMENT',
        amount: DemoConfig.defaultBalance,
        description: '체험판 GP 지급',
        balanceAfter: DemoConfig.defaultBalance,
        createdAt: now,
      ),
    );
    return db;
  }

  Future<void> _save() {
    final raw = jsonEncode(_db.toJson());
    // 저장 순서를 지킨다(마지막 저장이 마지막 상태).
    return _saving = _saving.then((_) => _storage.write(stateKey, raw));
  }

  // ── 체험판 전용 동작(앱 API가 아니라 체험판 화면에서 직접 부른다) ──────

  /// 체험판 초기화: 모든 기록을 지우고 처음 상태로. 로그인 세션도 끊긴다.
  Future<void> reset() async {
    await ensureReady();
    _now = _nowMs();
    _db = _seed();
    await _save();
  }

  /// 운영자 모드 체험: 이 세션 사용자의 role을 바꾼다.
  Future<void> setAdmin(String? token, bool admin) => _demoAction(() {
    _authUser(token).role = admin ? 'ADMIN' : 'USER';
  });

  /// 배송 진행 시뮬레이션: 내 배송 한 건을 다음 단계로.
  /// REQUESTED → SHIPPING(체험판 택배, DEMO-…) → DELIVERED.
  Future<String> simulateShippingStep(String? token, int shipmentId) =>
      _demoAction(() {
        final user = _authUser(token);
        final shipment = _db.shipments
            .where((s) => s.id == shipmentId && s.userId == user.id)
            .firstOrNull;
        if (shipment == null) throw _notFound('Shipping request');
        final next = switch (shipment.status) {
          'REQUESTED' => 'SHIPPING',
          'SHIPPING' => 'DELIVERED',
          _ => throw _Fail(409, 10005, 'Shipment already delivered'),
        };
        _moveShipment(shipment, next, null);
        return shipment.status;
      });

  /// 검사 → 변경 → 저장. 실패하면 아무것도 바꾸지 않는다.
  Future<T> _demoAction<T>(T Function() action) async {
    await ensureReady();
    _now = _nowMs();
    final before = jsonEncode(_db.toJson());
    try {
      final result = action();
      await _save();
      return result;
    } on _Fail catch (f) {
      _db = DemoState.fromJson(jsonDecode(before) as Map<String, dynamic>);
      throw DemoActionException(f.code, f.message);
    }
  }

  // ── 요청 처리 ─────────────────────────────────────────────────────

  /// 요청 하나를 처리하고 서버와 같은 HTTP 상태·응답 본문을 돌려준다.
  Future<DemoResponse> handle(
    String method,
    String url, {
    Object? body,
    String? token,
  }) async {
    await ensureReady();
    final uri = Uri.parse(url);
    final verb = method.toUpperCase();
    final shownUrl = uri.hasQuery ? '${uri.path}?${uri.query}' : uri.path;
    _now = _nowMs();
    _mutatedOnGet = false;
    _afterFail.clear();
    // 쓰기 요청은 실패하면 처음 상태로 되돌린다(서버 트랜잭션 롤백).
    final before = verb == 'GET' ? null : jsonEncode(_db.toJson());
    try {
      final (status, data) = _route(
        verb,
        uri.pathSegments.where((s) => s.isNotEmpty).toList(),
        uri.queryParameters,
        body is Map ? body.cast<String, dynamic>() : const <String, dynamic>{},
        token,
      );
      if (before != null || _mutatedOnGet) await _save();
      return DemoResponse(status, {
        'statusCode': 10000,
        'message': 'success',
        'data': data,
      });
    } on _Fail catch (f) {
      await _rollback(before);
      return DemoResponse(f.httpStatus, {
        'statusCode': f.code,
        'message': f.message,
        'errors': f.errors,
        'url': shownUrl,
      });
    } catch (_) {
      await _rollback(before);
      return DemoResponse(500, {
        'statusCode': 10099,
        'message': 'Internal server error',
        'errors': <String>[],
        'url': shownUrl,
      });
    }
  }

  bool _mutatedOnGet = false;

  /// 롤백 뒤에 남길 기록. 서버가 트랜잭션 밖에서 쓰는 것(주문 FAILED 등).
  final List<void Function()> _afterFail = [];

  Future<void> _rollback(String? before) async {
    if (before != null) {
      _db = DemoState.fromJson(jsonDecode(before) as Map<String, dynamic>);
    }
    if (_afterFail.isEmpty) return;
    for (final record in _afterFail) {
      record();
    }
    _afterFail.clear();
    await _save();
  }

  (int, Object?) _route(
    String method,
    List<String> seg,
    Map<String, String> query,
    Map<String, dynamic> body,
    String? token,
  ) {
    if (seg.isEmpty) throw _routeNotFound(method, seg);
    final head = seg.first;
    final rest = seg.sublist(1);
    switch ((method, head, rest.length)) {
      // auth
      case ('POST', 'auth', 1) when rest[0] == 'signup':
        return (201, _signup(body));
      case ('POST', 'auth', 1) when rest[0] == 'login':
        return (200, _login(body));
      case ('GET', 'auth', 1) when rest[0] == 'providers':
        return (200, {'providers': <String>[]});
      case ('POST', 'auth', 1) when rest[0] == 'social-login':
        return (200, _socialLogin(body));
      // users
      case ('GET', 'users', 1) when rest[0] == 'me':
        return (200, _toProfile(_authUser(token)));
      case ('PATCH', 'users', 1) when rest[0] == 'me':
        return (200, _updateProfile(_authUser(token), body));
      case ('DELETE', 'users', 1) when rest[0] == 'me':
        return (200, _deleteAccount(_authUser(token)));
      // gachas
      case ('GET', 'gachas', 0):
        return (200, _listGachas(query));
      case ('GET', 'gachas', 1):
        return (200, _gachaDetail(_parseId(rest[0])));
      case ('GET', 'gachas', 2) when rest[1] == 'odds':
        return (200, _gachaOdds(_parseId(rest[0])));
      case ('GET', 'gachas', 2) when rest[1] == 'pity':
        final user = _authUser(token);
        return (200, _gachaPity(user, _parseId(rest[0])));
      // draws
      case ('POST', 'draws', 0):
        return (201, _createDraw(_authUser(token), body));
      case ('GET', 'draws', 1) when rest[0] == 'stats':
        final user = _authUser(token);
        return (
          200,
          {
            'totalDrawCount': _db.draws
                .where((d) => d.userId == user.id)
                .length,
          },
        );
      // inventory
      case ('GET', 'inventory', 0):
        return (200, _listInventory(_authUser(token), query));
      case ('POST', 'inventory', 1) when rest[0] == 'exchange':
        return (200, _exchange(_authUser(token), body));
      // shipping
      case ('POST', 'shipping-requests', 0):
        return (201, _createShipping(_authUser(token), body));
      case ('GET', 'shipping-requests', 0):
        return (200, _listShipping(_authUser(token), query));
      // wallet
      case ('GET', 'wallet', 1) when rest[0] == 'balance':
        return (200, {'balance': _authUser(token).coinBalance});
      case ('GET', 'wallet', 1) when rest[0] == 'point-history':
        return (200, _pointHistory(_authUser(token), query));
      case ('POST', 'wallet', 1) when rest[0] == 'topup':
        _authUser(token);
        // 체험판은 운영 서버처럼 결제(/payments)로만 충전한다.
        throw _Fail(
          403,
          10003,
          'Demo top-up is disabled in production; use /payments',
        );
      case ('GET', 'wallet', 1) when rest[0] == 'limit':
        return (200, _getTopupLimit(_authUser(token)));
      case ('PUT', 'wallet', 1) when rest[0] == 'limit':
        return (200, _updateTopupLimit(_authUser(token), body));
      // rewards
      case ('GET', 'rewards', 1) when rest[0] == 'attendance':
        return (200, _getAttendance(_authUser(token)));
      case ('POST', 'rewards', 1) when rest[0] == 'attendance':
        return (201, _checkIn(_authUser(token)));
      // banners
      case ('GET', 'banners', 0):
        return (200, _activeBanners());
      // rankings
      case ('GET', 'rankings', 1) when rest[0] == 'users':
        return (200, _rankUsers(_limitParam(query, 50)));
      case ('GET', 'rankings', 1) when rest[0] == 'gachas':
        return (200, _rankGachas(_limitParam(query, 20)));
      case ('GET', 'rankings', 1) when rest[0] == 'wins':
        return (200, _recentWins(_limitParam(query, 30)));
      // payments
      case ('GET', 'payments', 1) when rest[0] == 'config':
        return (200, _paymentConfig(_authUser(token)));
      case ('POST', 'payments', 1) when rest[0] == 'orders':
        return (201, _createOrder(_authUser(token), body));
      case ('GET', 'payments', 1) when rest[0] == 'orders':
        return (200, _listOrders(_authUser(token)));
      case ('POST', 'payments', 1) when rest[0] == 'confirm':
        return (200, _confirmPayment(_authUser(token), body));
      case ('POST', 'payments', 1) when rest[0] == 'webhook':
        return (200, {'received': true});
      // admin
      case (_, 'admin', _):
        return _routeAdmin(method, rest, query, body, _adminUser(token));
    }
    throw _routeNotFound(method, seg);
  }

  // ── 공통 ──────────────────────────────────────────────────────────

  DateTime _nowMs() => DateTime.fromMillisecondsSinceEpoch(
    _clock().millisecondsSinceEpoch,
    isUtc: true,
  );

  /// JwtAuthGuard: 토큰이 없거나, 모르는 토큰이거나, 탈퇴한 계정이면 401.
  DemoUser _authUser(String? token) {
    final id = token == null ? null : _db.sessions[token];
    final user = id == null
        ? null
        : _db.users.where((u) => u.id == id && u.deletedAt == null).firstOrNull;
    if (user == null) throw _Fail(401, 10002, 'Unauthorized');
    return user;
  }

  /// AdminGuard: 매 요청 role을 다시 읽는다.
  DemoUser _adminUser(String? token) {
    final user = _authUser(token);
    if (user.role != 'ADMIN') throw _Fail(403, 10003, 'Admin only');
    return user;
  }

  DemoUser? _userById(int id) => _db.users.where((u) => u.id == id).firstOrNull;

  /// 잔액을 바꾸고 포인트 내역 한 줄을 남긴다.
  void _ledger(
    DemoUser user, {
    required String type,
    required String reason,
    required int amount,
    required String description,
    int? balanceAfter,
  }) {
    _db.ledger.add(
      DemoLedgerEntry(
        id: _db.nextId('wallet_transactions'),
        userId: user.id,
        type: type,
        reason: reason,
        amount: amount,
        description: description,
        balanceAfter: balanceAfter ?? user.coinBalance,
        createdAt: _now,
      ),
    );
  }

  String _issueToken(DemoUser user) {
    final token = 'demo.${user.id}.${_hex(24)}';
    _db.sessions[token] = user.id;
    return token;
  }

  String _hex(int bytes) => [
    for (var i = 0; i < bytes; i++)
      _random.nextInt(256).toRadixString(16).padLeft(2, '0'),
  ].join();

  static String _hashPassword(String password, String salt) =>
      sha256.convert(utf8.encode('$salt:$password')).toString();

  /// ParseIntPipe.
  int _parseId(String raw) {
    final v = int.tryParse(raw);
    if (v == null || !RegExp(r'^-?\d+$').hasMatch(raw)) {
      throw _validation(['Validation failed (numeric string is expected)']);
    }
    return v;
  }

  /// `?limit=` with DefaultValuePipe + ParseIntPipe.
  int _limitParam(Map<String, String> query, int fallback) {
    final raw = query['limit'];
    return raw == null || raw.isEmpty ? fallback : _parseId(raw);
  }

  /// page/limit 쿼리(class-validator @IsInt @Min(1)).
  (int, int) _paging(
    Map<String, String> query, {
    int defaultLimit = 20,
    int? maxLimit,
  }) {
    final errors = <String>[];
    int read(String key, int fallback) {
      final raw = query[key];
      if (raw == null) return fallback;
      final v = int.tryParse(raw);
      if (v == null) {
        errors.add('$key must be an integer number');
        return fallback;
      }
      if (v < 1) errors.add('$key must not be less than 1');
      return v;
    }

    final page = read('page', 1);
    var limit = read('limit', defaultLimit);
    if (errors.isNotEmpty) throw _validation(errors);
    if (maxLimit != null) limit = min(limit, maxLimit);
    return (page, limit);
  }

  static List<T> _pageOf<T>(List<T> rows, int page, int limit) =>
      rows.skip((page - 1) * limit).take(limit).toList();

  static String _iso(DateTime d) => d.toUtc().toIso8601String();
  static String? _isoOrNull(DateTime? d) => d == null ? null : _iso(d);

  /// JS `toLocaleString('ko-KR')` (정수).
  static String _comma(int v) => v.toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+$)'),
    (m) => '${m[1]},',
  );

  static _Fail _validation(List<String> errors) =>
      _Fail(400, 10001, 'Validation failed', errors);

  static _Fail _notFound(String what) => _Fail(404, 10004, '$what not found');

  static _Fail _routeNotFound(String method, List<String> seg) =>
      _Fail(404, 10004, 'Cannot $method /${seg.join('/')}');
}

/// 체험판 응답(HTTP 상태 + 서버와 같은 JSON 본문).
class DemoResponse {
  final int httpStatus;
  final Map<String, dynamic> body;
  const DemoResponse(this.httpStatus, this.body);
}

/// 체험판 전용 동작([DemoBackend.setAdmin] 등)이 실패했을 때.
class DemoActionException implements Exception {
  final int code;
  final String message;
  const DemoActionException(this.code, this.message);

  @override
  String toString() => message;
}

/// 서버 BusinessException.
class _Fail implements Exception {
  final int httpStatus;
  final int code;
  final String message;
  final List<String> errors;
  _Fail(this.httpStatus, this.code, this.message, [this.errors = const []]);
}

/// class-validator 흉내(체험판이 받는 본문은 앱이 만든 것이라 간단히).
class _Check {
  final Map<String, dynamic> body;
  final List<String> errors = [];
  _Check(this.body);

  bool has(String key) => body.containsKey(key) && body[key] != null;

  String? string(
    String key, {
    bool optional = false,
    int? minLength,
    int? maxLength,
    RegExp? pattern,
    String? patternMessage,
  }) {
    final v = body[key];
    if (v == null) {
      if (!optional) {
        errors.add('$key must be a string');
      }
      return null;
    }
    if (v is! String) {
      errors.add('$key must be a string');
      return null;
    }
    if (minLength != null && v.length < minLength) {
      errors.add('$key must be longer than or equal to $minLength characters');
    }
    if (maxLength != null && v.length > maxLength) {
      errors.add('$key must be shorter than or equal to $maxLength characters');
    }
    if (pattern != null && !pattern.hasMatch(v)) {
      errors.add(
        patternMessage ??
            '$key must match ${pattern.pattern} regular expression',
      );
    }
    return v;
  }

  int? integer(String key, {bool optional = false, int? min, int? max}) {
    final v = body[key];
    if (v == null) {
      if (!optional) errors.add('$key must be an integer number');
      return null;
    }
    if (v is! int && !(v is double && v == v.roundToDouble())) {
      errors.add('$key must be an integer number');
      return null;
    }
    final n = (v as num).toInt();
    if (min != null && n < min) errors.add('$key must not be less than $min');
    if (max != null && n > max) {
      errors.add('$key must not be greater than $max');
    }
    return n;
  }

  bool? boolean(String key) {
    final v = body[key];
    if (v == null) return null;
    if (v is! bool) {
      errors.add('$key must be a boolean value');
      return null;
    }
    return v;
  }

  List<int>? intList(
    String key, {
    int minSize = 1,
    int? maxSize,
    bool unique = false,
    int? minEach,
  }) {
    final v = body[key];
    if (v is! List) {
      errors.add('$key must be an array');
      return null;
    }
    if (v.length < minSize) {
      errors.add('$key must contain at least $minSize elements');
    }
    if (maxSize != null && v.length > maxSize) {
      errors.add('$key must contain no more than $maxSize elements');
    }
    if (v.any((e) => e is! int)) {
      errors.add('each value in $key must be an integer number');
      return null;
    }
    final ints = v.cast<int>();
    if (unique && ints.toSet().length != ints.length) {
      errors.add("All $key's elements must be unique");
    }
    if (minEach != null && ints.any((e) => e < minEach)) {
      errors.add('each value in $key must not be less than $minEach');
    }
    return ints;
  }

  String? oneOf(String key, List<String> values, {bool optional = false}) {
    final v = body[key];
    if (v == null && optional) return null;
    if (v is! String || !values.contains(v)) {
      errors.add(
        '$key must be one of the following values: ${values.join(', ')}',
      );
      return null;
    }
    return v;
  }

  void done() {
    if (errors.isNotEmpty) throw DemoBackend._validation(errors);
  }
}

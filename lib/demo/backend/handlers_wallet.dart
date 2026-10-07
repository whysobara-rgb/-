part of 'demo_backend.dart';

/// GP 내역·월 충전 한도·출석·충전.
/// 원본: wallet.service.ts, topup-limit.ts, rewards.service.ts,
/// payments.service.ts.
extension _WalletHandlers on DemoBackend {
  // ── wallet.service.ts ─────────────────────────────────────────────

  Map<String, dynamic> _pointHistory(DemoUser user, Map<String, String> q) {
    final (page, limit) = _paging(q);
    final type = q['type'];
    const types = ['EARN', 'USE', 'EXPIRE'];
    if (type != null && !types.contains(type)) {
      throw DemoBackend._validation([
        'type must be one of the following values: ${types.join(', ')}',
      ]);
    }
    final rows =
        _db.ledger
            .where(
              (t) => t.userId == user.id && (type == null || t.type == type),
            )
            .toList()
          ..sort((a, b) {
            final byTime = b.createdAt.compareTo(a.createdAt);
            return byTime != 0 ? byTime : b.id.compareTo(a.id);
          });
    return {
      'items': [
        for (final t in DemoBackend._pageOf(rows, page, limit))
          {
            'id': t.id,
            'type': t.type,
            'reason': t.reason,
            'amount': t.amount,
            'description': t.description,
            'balanceAfter': t.balanceAfter,
            'createdAt': DemoBackend._iso(t.createdAt),
          },
      ],
      'page': page,
      'limit': limit,
      'totalCount': rows.length,
    };
  }

  TopupLimitState _limitState(DemoUser u) => TopupLimitState(
    u.monthlyTopupLimit,
    u.pendingMonthlyTopupLimit,
    u.pendingTopupLimitEffectiveAt,
  );

  void _applyLimitState(DemoUser u, TopupLimitState s) {
    u
      ..monthlyTopupLimit = s.monthlyTopupLimit
      ..pendingMonthlyTopupLimit = s.pendingMonthlyTopupLimit
      ..pendingTopupLimitEffectiveAt = s.pendingTopupLimitEffectiveAt;
  }

  /// 대기 중인 한도 변경의 적용 시각이 지났으면 반영한다.
  void _applyDueLimitChange(DemoUser user) {
    final before = _limitState(user);
    final after = resolveTopupLimit(before, _now);
    if (!identical(after, before)) {
      _applyLimitState(user, after);
      _mutatedOnGet = true;
    }
  }

  /// 이번 KST 달의 충전(TOPUP)액. 보너스는 넣지 않는다.
  int _topupsThisMonth(int userId) {
    final since = startOfKstMonth(_now);
    return _db.ledger
        .where(
          (t) =>
              t.userId == userId &&
              t.reason == 'TOPUP' &&
              !t.createdAt.isBefore(since),
        )
        .fold(0, (s, t) => s + t.amount);
  }

  /// 월 한도를 넘는 충전이면 10007(errors에 remaining:N).
  void _assertTopupAllowed(DemoUser user, int amount) {
    _applyDueLimitChange(user);
    final limit = user.monthlyTopupLimit;
    if (limit == null) return;
    final remaining = max(0, limit - _topupsThisMonth(user.id));
    if (amount > remaining) {
      throw _Fail(
        400,
        10007,
        'Monthly top-up limit exceeded (remaining $remaining GP)',
        ['remaining:$remaining'],
      );
    }
  }

  Map<String, dynamic> _describeLimit(DemoUser user) {
    final used = _topupsThisMonth(user.id);
    final limit = user.monthlyTopupLimit;
    return {
      'monthlyLimit': limit,
      'usedThisMonth': used,
      'remainingThisMonth': limit == null ? null : max(0, limit - used),
      'pending': user.pendingTopupLimitEffectiveAt != null
          ? {
              'monthlyLimit': user.pendingMonthlyTopupLimit,
              'effectiveAt': DemoBackend._iso(
                user.pendingTopupLimitEffectiveAt!,
              ),
            }
          : null,
    };
  }

  Map<String, dynamic> _getTopupLimit(DemoUser user) {
    _applyDueLimitChange(user);
    return _describeLimit(user);
  }

  Map<String, dynamic> _updateTopupLimit(
    DemoUser user,
    Map<String, dynamic> body,
  ) {
    // 필수 필드. 명시적인 null만 숫자 검사를 건너뛴다(한도 해제).
    final explicitNull =
        body.containsKey('monthlyLimit') && body['monthlyLimit'] == null;
    int? requested;
    if (!explicitNull) {
      final c = _Check(body);
      requested = c.integer('monthlyLimit', min: 0, max: 100000000);
      c.done();
    }
    _applyLimitState(
      user,
      requestTopupLimitChange(_limitState(user), requested, _now),
    );
    return _describeLimit(user);
  }

  // ── rewards.service.ts ────────────────────────────────────────────

  DemoCheckin? _lastCheckin(int userId) {
    DemoCheckin? last;
    for (final c in _db.checkins) {
      if (c.userId != userId) continue;
      if (last == null || c.checkinDate.compareTo(last.checkinDate) > 0) {
        last = c;
      }
    }
    return last;
  }

  Map<String, dynamic> _getAttendance(DemoUser user) {
    final today = toKstDateString(_now);
    final last = _lastCheckin(user.id);
    final checkedInToday = last?.checkinDate == today;
    final streakAlive =
        last != null &&
        (checkedInToday || last.checkinDate == addDays(today, -1));
    final upcoming = nextStreakDay(
      last == null
          ? null
          : (checkinDate: last.checkinDate, streakDay: last.streakDay),
      checkedInToday ? addDays(today, 1) : today,
    );
    return {
      'today': today,
      'checkedInToday': checkedInToday,
      'streakDay': streakAlive ? last.streakDay : 0,
      'nextStreakDay': upcoming,
      'nextReward': rewardForStreakDay(upcoming),
      'schedule': [
        for (final (i, reward) in attendanceRewards.indexed)
          {'day': i + 1, 'reward': reward},
      ],
    };
  }

  Map<String, dynamic> _checkIn(DemoUser user) {
    final today = toKstDateString(_now);
    final last = _lastCheckin(user.id);
    if (last?.checkinDate == today) {
      throw _Fail(409, 10008, 'Already checked in today');
    }
    final streakDay = nextStreakDay(
      last == null
          ? null
          : (checkinDate: last.checkinDate, streakDay: last.streakDay),
      today,
    );
    final reward = rewardForStreakDay(streakDay);
    _db.checkins.add(
      DemoCheckin(
        userId: user.id,
        checkinDate: today,
        streakDay: streakDay,
        reward: reward,
      ),
    );
    user.coinBalance += reward;
    _ledger(
      user,
      type: 'EARN',
      reason: 'ATTENDANCE',
      amount: reward,
      description: '출석체크 $streakDay일차',
    );
    return {
      'checkinDate': today,
      'streakDay': streakDay,
      'reward': reward,
      'balanceAfter': user.coinBalance,
    };
  }

  // ── payments.service.ts ───────────────────────────────────────────
  //
  // 토스 결제위젯 대신 체험판 확인 시트를 쓴다. 승인은 토스가 "DONE"을
  // 준 것처럼 처리하고, 금액 검증·한도 재확인·GP 지급(첫 충전·대량 보너스)
  // ·멱등성은 서버와 같다.

  static const String _demoMethod = '체험 결제';

  bool _hasCompletedPayment(int userId) =>
      _db.orders.any((o) => o.userId == userId && o.status == 'DONE');

  int _firstBonusFor(int gp) => firstTopupBonusFor(
    gp,
    rate: _catalog.firstTopupRate,
    maxGp: _catalog.firstTopupMaxGp,
  );

  /// 서버: `GVC_` + HMAC-SHA256(secret, userId) 앞 40자.
  String _customerKey(int userId) =>
      'GVC_${Hmac(sha256, utf8.encode('demo')).convert(utf8.encode('$userId')).toString().substring(0, 40)}';

  Map<String, dynamic> _paymentConfig(DemoUser user) {
    final eligible = !_hasCompletedPayment(user.id);
    return {
      'enabled': true,
      'clientKey': null,
      'customerKey': _customerKey(user.id),
      'packages': [
        for (final p in _catalog.packages)
          {
            ...p,
            'firstTopupBonusGp': eligible
                ? _firstBonusFor((p['gp'] as num).toInt())
                : 0,
          },
      ],
      'firstTopupBonus': {
        'rate': _catalog.firstTopupRate,
        'maxGp': _catalog.firstTopupMaxGp,
        'eligible': eligible,
      },
    };
  }

  Map<String, dynamic> _createOrder(DemoUser user, Map<String, dynamic> body) {
    final c = _Check(body);
    final packageId = c.oneOf('packageId', [
      for (final p in _catalog.packages) p['id'] as String,
    ]);
    c.done();
    final pkg = _catalog.packageOf(packageId!);
    if (pkg == null) throw _Fail(400, 10001, 'Unknown package');
    final price = (pkg['price'] as num).toInt();
    final gp = (pkg['gp'] as num).toInt();

    _assertTopupAllowed(user, price);
    final order = DemoOrder(
      id: _db.nextId('payment_orders'),
      orderId: 'GV${_hex(16)}',
      userId: user.id,
      packageId: packageId,
      amount: price,
      gp: gp,
      bonusGp: (pkg['bonusGp'] as num).toInt(),
      createdAt: _now,
      updatedAt: _now,
    );
    _db.orders.add(order);
    return {
      'orderId': order.orderId,
      'orderName': '가치가차 ${DemoBackend._comma(gp)} GP',
      'amount': order.amount,
      'gp': order.gp,
      'bonusGp': order.bonusGp,
      'firstTopupBonusGp': _hasCompletedPayment(user.id)
          ? 0
          : _firstBonusFor(gp),
      'clientKey': null,
      'customerKey': _customerKey(user.id),
    };
  }

  Map<String, dynamic> _confirmPayment(
    DemoUser user,
    Map<String, dynamic> body,
  ) {
    final c = _Check(body);
    final paymentKey = c.string('paymentKey', maxLength: 200);
    final orderId = c.string('orderId', pattern: RegExp(r'^GV[0-9a-f]{32}$'));
    final amount = c.integer('amount', min: 1);
    c.done();

    final order = _db.orders
        .where((o) => o.orderId == orderId && o.userId == user.id)
        .firstOrNull;
    if (order == null) throw _Fail(404, 10004, 'Order not found');

    if (order.status == 'DONE') {
      if (order.paymentKey != paymentKey) throw _orderConflict(order);
      return _describeOrder(order, user); // 다시 불러도 결과만 돌려준다.
    }
    if (order.status == 'FAILED' || order.status == 'CANCELED') {
      throw _orderConflict(order);
    }
    if (amount != order.amount) {
      if (order.status == 'READY') {
        _recordOrderFailure(order.id, 'Amount does not match the order');
      }
      throw _Fail(400, 10014, 'Amount does not match the order');
    }

    if (order.status == 'READY') {
      // claim(): 한도를 다시 확인하고 READY → IN_PROGRESS.
      _assertTopupAllowed(user, order.amount);
      order
        ..status = 'IN_PROGRESS'
        ..paymentKey = paymentKey
        ..updatedAt = _now;
    } else if (order.paymentKey != paymentKey) {
      throw _orderConflict(order);
    }
    // 토스 승인 대신: 체험판 결제는 항상 그 주문 금액 그대로 승인된다.
    return _finalizeOrder(order, user);
  }

  /// GP 지급(여러 번 불러도 한 번만). 서버 finalize()와 같은 순서·사유.
  Map<String, dynamic> _finalizeOrder(DemoOrder order, DemoUser user) {
    if (order.status == 'DONE') return _describeOrder(order, user);
    final firstBonus = _hasCompletedPayment(user.id)
        ? 0
        : _firstBonusFor(order.gp);
    void credit(int amount, String reason, String description) {
      if (amount <= 0) return;
      user.coinBalance += amount;
      _ledger(
        user,
        type: 'EARN',
        reason: reason,
        amount: amount,
        description: description,
      );
    }

    credit(
      order.gp,
      'TOPUP',
      'GP 충전 (${DemoBackend._comma(order.amount)}원 결제)',
    );
    credit(order.bonusGp, 'BONUS', '대량 충전 보너스');
    credit(firstBonus, 'BONUS', '첫 충전 보너스');

    order
      ..status = 'DONE'
      ..method = _demoMethod
      ..approvedAt = _now
      ..firstTopupBonusGp = firstBonus
      ..updatedAt = _now;
    return _describeOrder(order, user);
  }

  /// 서버 fail(): 롤백과 상관없이 주문을 FAILED로 남긴다.
  void _recordOrderFailure(int orderPk, String reason) {
    final failedAt = _now;
    _afterFail.add(() {
      final o = _db.orders.where((o) => o.id == orderPk).firstOrNull;
      if (o == null) return;
      o
        ..status = 'FAILED'
        ..failureReason = reason.length > 500
            ? reason.substring(0, 500)
            : reason
        ..updatedAt = failedAt;
    });
  }

  static _Fail _orderConflict(DemoOrder order) =>
      _Fail(409, 10005, 'Order is ${order.status}', ['status:${order.status}']);

  Map<String, dynamic> _describeOrderRow(DemoOrder o) => {
    'orderId': o.orderId,
    'status': o.status,
    'packageId': o.packageId,
    'amount': o.amount,
    'gp': o.gp,
    'bonusGp': o.bonusGp,
    'firstTopupBonusGp': o.firstTopupBonusGp,
    'totalGp': o.gp + o.bonusGp + o.firstTopupBonusGp,
    'method': o.method,
    'approvedAt': DemoBackend._isoOrNull(o.approvedAt),
    'createdAt': DemoBackend._iso(o.createdAt),
  };

  Map<String, dynamic> _describeOrder(DemoOrder o, DemoUser user) => {
    ..._describeOrderRow(o),
    'balanceAfter': user.coinBalance,
  };

  Map<String, dynamic> _listOrders(DemoUser user) {
    final rows = _db.orders.where((o) => o.userId == user.id).toList()
      ..sort((a, b) {
        final byTime = b.createdAt.compareTo(a.createdAt);
        return byTime != 0 ? byTime : b.id.compareTo(a.id);
      });
    return {
      'items': [
        for (final o in rows.take(50))
          if (o.status != 'READY') _describeOrderRow(o),
      ],
    };
  }
}

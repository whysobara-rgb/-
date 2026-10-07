part of 'demo_backend.dart';

/// 운영자 API(`/admin/*`). 원본: admin.service.ts.
///
/// 체험판에서는 이 기기에 있는 계정·주문·뽑기·배송만 다룬다.
extension _AdminHandlers on DemoBackend {
  (int, Object?) _routeAdmin(
    String method,
    List<String> seg,
    Map<String, String> q,
    Map<String, dynamic> body,
    DemoUser admin,
  ) {
    final head = seg.isEmpty ? '' : seg.first;
    switch ((method, head, seg.length)) {
      case ('GET', 'stats', 1):
        return (200, _adminStats());
      case ('GET', 'shipping-requests', 1):
        return (200, _adminListShipping(q));
      case ('PATCH', 'shipping-requests', 2):
        return (200, _adminUpdateShipping(_parseId(seg[1]), body));
      case ('GET', 'gachas', 1):
        return (200, _adminListGachas());
      case ('PATCH', 'gachas', 2):
        return (200, _adminUpdateGacha(_parseId(seg[1]), body));
      case ('GET', 'banners', 1):
        final rows = [..._db.banners]..sort(_CatalogHandlers._bannerOrder);
        return (
          200,
          {
            'items': [for (final b in rows) _adminBanner(b)],
          },
        );
      case ('POST', 'banners', 1):
        return (201, _adminCreateBanner(body));
      case ('PATCH', 'banners', 2):
        return (200, _adminUpdateBanner(_parseId(seg[1]), body));
      case ('GET', 'payments', 1):
        return (200, _adminListPayments(q));
      case ('GET', 'users', 1):
        return (200, _adminFindUsers(q['search']));
    }
    throw DemoBackend._routeNotFound(method, ['admin', ...seg]);
  }

  // ── 대시보드 ────────────────────────────────────────────────────────

  Map<String, dynamic> _adminStats() {
    final todayStart = startOfKstDay(_now);
    final monthStart = startOfKstMonth(_now);
    bool since(DateTime? t, DateTime? from) =>
        t != null && (from == null || !t.isBefore(from));

    ({int total, int payers}) revenue(DateTime? from) {
      final done = _db.orders.where(
        (o) =>
            o.status == 'DONE' && (from == null || since(o.approvedAt, from)),
      );
      return (
        total: done.fold(0, (s, o) => s + o.amount),
        payers: done.map((o) => o.userId).toSet().length,
      );
    }

    ({int draws, int spent}) draws(DateTime? from) {
      final rows = _db.draws.where(
        (d) => from == null || since(d.createdAt, from),
      );
      return (draws: rows.length, spent: rows.fold(0, (s, d) => s + d.spent));
    }

    final liveUsers = _db.users.where((u) => u.deletedAt == null);
    final revToday = revenue(todayStart);
    final revMonth = revenue(monthStart);
    final revTotal = revenue(null);
    final drawsToday = draws(todayStart);
    final drawsTotal = draws(null);
    final stale = _now.subtract(const Duration(minutes: 10));
    final toReview = _db.orders.where(
      (o) =>
          o.status == 'CANCELED' ||
          (o.status == 'FAILED' &&
              o.failureReason == 'Approved payment does not match') ||
          (o.status == 'IN_PROGRESS' && o.updatedAt.isBefore(stale)),
    );
    return {
      'today': {
        'revenue': revToday.total,
        'payingUsers': revToday.payers,
        'draws': drawsToday.draws,
        'gpSpentOnDraws': drawsToday.spent,
        'newUsers': liveUsers
            .where((u) => since(u.createdAt, todayStart))
            .length,
      },
      'month': {'revenue': revMonth.total, 'payingUsers': revMonth.payers},
      'total': {
        'revenue': revTotal.total,
        'draws': drawsTotal.draws,
        'gpSpentOnDraws': drawsTotal.spent,
        'users': liveUsers.length,
        'gpOutstanding': liveUsers.fold(0, (s, u) => s + u.coinBalance),
      },
      'actionRequired': {
        'shipmentsToSend': _db.shipments
            .where((s) => s.status == 'REQUESTED')
            .length,
        'shipmentsInTransit': _db.shipments
            .where((s) => s.status == 'SHIPPING')
            .length,
        'paymentsToReview': toReview.length,
      },
    };
  }

  // ── 배송 ──────────────────────────────────────────────────────────

  Map<String, dynamic> _adminListShipping(Map<String, String> q) {
    final (page, limit) = _paging(q, defaultLimit: 30, maxLimit: 100);
    final status = q['status'];
    const statuses = ['REQUESTED', 'SHIPPING', 'DELIVERED'];
    if (status != null && !statuses.contains(status)) {
      throw DemoBackend._validation([
        'status must be one of the following values: ${statuses.join(', ')}',
      ]);
    }
    // 오래된 것부터(처리할 순서).
    final rows =
        _db.shipments
            .where((s) => status == null || s.status == status)
            .toList()
          ..sort((a, b) {
            final byTime = a.createdAt.compareTo(b.createdAt);
            return byTime != 0 ? byTime : a.id.compareTo(b.id);
          });
    return {
      'items': [
        for (final s in DemoBackend._pageOf(rows, page, limit))
          {
            'shippingRequestId': s.id,
            'status': s.status,
            'user': {
              'id': s.userId,
              'nickname': _userById(s.userId)?.nickname,
              'email': _userById(s.userId)?.email,
            },
            'recipientName': s.recipientName,
            'phone': s.phone,
            'address': s.address,
            'notes': s.notes,
            'trackingCompany': s.trackingCompany,
            'trackingNumber': s.trackingNumber,
            'shippedAt': DemoBackend._isoOrNull(s.shippedAt),
            'deliveredAt': DemoBackend._isoOrNull(s.deliveredAt),
            'createdAt': DemoBackend._iso(s.createdAt),
            'items': [
              for (final inv in _shipmentItems(s))
                {
                  'inventoryItemId': inv.id,
                  'name': _catalog.items[inv.itemId]!.name,
                  'rarity': _catalog.items[inv.itemId]!.rarity,
                  'estimatedValue': _catalog.items[inv.itemId]!.estimatedValue,
                },
            ],
          },
      ],
      'page': page,
      'limit': limit,
      'totalCount': rows.length,
    };
  }

  static const Map<String, List<String>> _shippingTransitions = {
    'REQUESTED': ['SHIPPING'],
    // SHIPPING → SHIPPING: 송장 수정.
    'SHIPPING': ['SHIPPING', 'DELIVERED'],
    'DELIVERED': [],
  };

  Map<String, dynamic> _adminUpdateShipping(int id, Map<String, dynamic> body) {
    final c = _Check(body);
    final status = c.oneOf('status', ['REQUESTED', 'SHIPPING', 'DELIVERED']);
    c.string('trackingCompany', optional: true, minLength: 1, maxLength: 50);
    final number = c.string(
      'trackingNumber',
      optional: true,
      minLength: 1,
      maxLength: 50,
    );
    c.done();
    final shipment = _db.shipments.where((s) => s.id == id).firstOrNull;
    if (shipment == null) throw DemoBackend._notFound('Shipping request');
    _moveShipment(shipment, status!, number);
    return {
      'shippingRequestId': shipment.id,
      'status': shipment.status,
      'trackingCompany': shipment.trackingCompany,
      'trackingNumber': shipment.trackingNumber,
      'shippedAt': DemoBackend._isoOrNull(shipment.shippedAt),
      'deliveredAt': DemoBackend._isoOrNull(shipment.deliveredAt),
    };
  }

  /// 서버 updateShipping과 같은 상태 전이. 보관함 상품 상태도 따라간다.
  ///
  /// 체험판은 실제로 발송하지 않으므로 택배사는 언제나 "체험판 택배"이고
  /// 송장번호는 `DEMO-`로 시작한다(운영자가 입력한 번호는 DEMO- 뒤에 붙인다).
  void _moveShipment(DemoShipment shipment, String next, String? number) {
    final allowed = _shippingTransitions[shipment.status] ?? const [];
    if (!allowed.contains(next)) {
      throw _Fail(
        409,
        10005,
        'Cannot move a ${shipment.status} shipment to $next',
      );
    }
    if (next == 'SHIPPING') {
      shipment
        ..trackingCompany = DemoConfig.trackingCompany
        ..trackingNumber = _demoTrackingNumber(
          number ?? shipment.trackingNumber,
        )
        ..shippedAt = shipment.shippedAt ?? _now;
    }
    if (next == 'DELIVERED') shipment.deliveredAt = _now;
    shipment
      ..status = next
      ..updatedAt = _now;
    for (final inv in _shipmentItems(shipment)) {
      inv.status = next == 'DELIVERED'
          ? InventoryStatus.delivered
          : InventoryStatus.shipping;
    }
  }

  String _demoTrackingNumber(String? given) {
    if (given != null && given.startsWith('DEMO-')) return given;
    if (given != null && given.isNotEmpty) {
      final v = 'DEMO-$given';
      return v.length > 50 ? v.substring(0, 50) : v;
    }
    final digits = [for (var i = 0; i < 10; i++) _random.nextInt(10)].join();
    return 'DEMO-$digits';
  }

  // ── 박스 ──────────────────────────────────────────────────────────

  Map<String, dynamic> _adminListGachas() {
    final rows = [..._catalog.gachas]
      ..sort((a, b) {
        final sa = _db.gachas[a['id'] as int]!.active ? 0 : 1;
        final sb = _db.gachas[b['id'] as int]!.active ? 0 : 1;
        return sa != sb ? sa - sb : (a['id'] as int).compareTo(b['id'] as int);
      });
    return {
      'items': [for (final g in rows) _adminGacha(g)],
    };
  }

  Map<String, dynamic> _adminGacha(Map<String, dynamic> g) {
    final id = g['id'] as int;
    final state = _db.gachas[id]!;
    final price = (g['price'] as num).toInt();
    final pool = _catalog.pools[id] ?? const <PoolItem>[];
    final economy = summarizeEconomy(
      [for (final p in pool) p.economy],
      price,
      (g['pityThreshold'] as num?)?.toInt(),
    );
    return {
      'id': id,
      'title': g['title'],
      'active': state.active,
      'price': price,
      'totalStock': state.totalStock,
      'soldCount': state.soldCount,
      'soldOut': state.soldCount >= state.totalStock,
      'revenueGp': state.soldCount * price,
      'pityThreshold': g['pityThreshold'],
      'itemCount': pool.length,
      'payoutRatioPercent': {
        'singleDraw': roundRatioPercent(economy.payoutRatio),
        'multiDraw': roundRatioPercent(economy.multiDrawPayoutRatio),
      },
    };
  }

  Map<String, dynamic> _adminUpdateGacha(int id, Map<String, dynamic> body) {
    final c = _Check(body);
    final active = c.boolean('active');
    final totalStock = c.integer('totalStock', optional: true, min: 0);
    c.done();
    final state = _db.gachas[id];
    if (state == null) throw DemoBackend._notFound('Gacha');
    if (totalStock != null) {
      if (totalStock < state.soldCount) {
        throw _Fail(
          400,
          10001,
          'totalStock cannot be below the ${state.soldCount} already sold',
        );
      }
      state.totalStock = totalStock;
    }
    if (active != null) state.active = active;
    return {
      'id': id,
      'active': state.active,
      'totalStock': state.totalStock,
      'soldCount': state.soldCount,
    };
  }

  // ── 배너 ──────────────────────────────────────────────────────────

  Map<String, dynamic> _adminBanner(DemoBanner b) => {
    ..._bannerResponse(b),
    'active': b.active,
    'priority': b.priority,
  };

  Map<String, dynamic> _adminCreateBanner(Map<String, dynamic> body) {
    _validateBannerBody(body);
    if (body['title'] == null) {
      throw _Fail(400, 10001, 'title is required');
    }
    final banner = DemoBanner(id: _db.nextId('banners'), title: '');
    _applyBanner(banner, body);
    _db.banners.add(banner);
    return _adminBanner(banner);
  }

  Map<String, dynamic> _adminUpdateBanner(int id, Map<String, dynamic> body) {
    _validateBannerBody(body);
    final banner = _db.banners.where((b) => b.id == id).firstOrNull;
    if (banner == null) throw DemoBackend._notFound('Banner');
    _applyBanner(banner, body);
    return _adminBanner(banner);
  }

  static const _linkTypes = [
    'GACHA',
    'ATTENDANCE',
    'TOPUP',
    'ODDS',
    'URL',
    'NONE',
  ];

  /// SaveBannerDto.
  void _validateBannerBody(Map<String, dynamic> body) {
    final c = _Check(body);
    c.string('title', optional: true, minLength: 1, maxLength: 100);
    c.string('subtitle', optional: true, maxLength: 200);
    c.string('badge', optional: true, maxLength: 30);
    c.string('imageUrl', optional: true, pattern: RegExp(r'^https://'));
    c.string(
      'accentColorHex',
      optional: true,
      pattern: RegExp(r'^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$'),
    );
    c.oneOf('linkType', _linkTypes, optional: true);
    c.string('linkTarget', optional: true, maxLength: 500);
    c.integer('priority', optional: true);
    c.boolean('active');
    for (final key in ['startsAt', 'endsAt']) {
      final v = body[key];
      if (v != null && (v is! String || DateTime.tryParse(v) == null)) {
        c.errors.add('$key must be a valid ISO 8601 date string');
      }
    }
    c.done();
  }

  /// 서버 applyBanner: 보낸 필드만 바꾸고(null은 지움), 링크 대상을 확인한다.
  void _applyBanner(DemoBanner b, Map<String, dynamic> body) {
    bool sent(String k) => body.containsKey(k);
    if (sent('title')) b.title = body['title'] as String;
    if (sent('subtitle')) b.subtitle = body['subtitle'] as String?;
    if (sent('badge')) b.badge = body['badge'] as String?;
    if (sent('imageUrl')) b.imageUrl = body['imageUrl'] as String?;
    if (sent('accentColorHex')) {
      b.accentColorHex = body['accentColorHex'] as String?;
    }
    if (sent('linkType') && body['linkType'] != null) {
      b.linkType = body['linkType'] as String;
    }
    if (sent('linkTarget')) b.linkTarget = body['linkTarget'] as String?;
    if (sent('priority') && body['priority'] != null) {
      b.priority = (body['priority'] as num).toInt();
    }
    if (sent('active') && body['active'] != null) {
      b.active = body['active'] as bool;
    }
    DateTime? date(Object? v) =>
        v == null ? null : DateTime.parse('$v').toUtc();
    if (sent('startsAt')) b.startsAt = date(body['startsAt']);
    if (sent('endsAt')) b.endsAt = date(body['endsAt']);

    final target = b.linkTarget;
    final needsBox =
        b.linkType == 'GACHA' ||
        (b.linkType == 'ODDS' && target != null && target.isNotEmpty);
    if (needsBox) {
      final exists =
          target != null &&
          RegExp(r'^\d+$').hasMatch(target) &&
          _catalog.details.containsKey(int.parse(target));
      if (!exists) {
        throw _Fail(400, 10001, 'linkTarget must be an existing box id');
      }
    }
    if (b.linkType == 'URL' &&
        !(target != null && target.startsWith('https://'))) {
      throw _Fail(400, 10001, 'linkTarget must be an https URL');
    }
    if (b.startsAt != null &&
        b.endsAt != null &&
        !b.endsAt!.isAfter(b.startsAt!)) {
      throw _Fail(400, 10001, 'endsAt must be after startsAt');
    }
  }

  // ── 결제·회원 ───────────────────────────────────────────────────────

  Map<String, dynamic> _adminListPayments(Map<String, String> q) {
    final (page, limit) = _paging(q, defaultLimit: 30, maxLimit: 100);
    final status = q['status'];
    const statuses = ['READY', 'IN_PROGRESS', 'DONE', 'FAILED', 'CANCELED'];
    if (status != null && !statuses.contains(status)) {
      throw DemoBackend._validation([
        'status must be one of the following values: ${statuses.join(', ')}',
      ]);
    }
    final rows =
        _db.orders
            .where(
              (o) => status == null ? o.status != 'READY' : o.status == status,
            )
            .toList()
          ..sort((a, b) {
            final byTime = b.createdAt.compareTo(a.createdAt);
            return byTime != 0 ? byTime : b.id.compareTo(a.id);
          });
    return {
      'items': [
        for (final o in DemoBackend._pageOf(rows, page, limit))
          {
            'orderId': o.orderId,
            'status': o.status,
            'user': {'id': o.userId, 'nickname': _userById(o.userId)?.nickname},
            'amount': o.amount,
            'totalGp': o.gp + o.bonusGp + o.firstTopupBonusGp,
            'method': o.method,
            'paymentKey': o.paymentKey,
            'failureReason': o.failureReason,
            'approvedAt': DemoBackend._isoOrNull(o.approvedAt),
            'createdAt': DemoBackend._iso(o.createdAt),
          },
      ],
      'page': page,
      'limit': limit,
      'totalCount': rows.length,
    };
  }

  Map<String, dynamic> _adminFindUsers(String? search) {
    final s = search == null || search.isEmpty
        ? null
        : search.substring(0, min(search.length, 100)).toLowerCase();
    final users =
        _db.users
            .where(
              (u) =>
                  u.deletedAt == null &&
                  (s == null ||
                      u.email.toLowerCase().contains(s) ||
                      u.nickname.toLowerCase().contains(s)),
            )
            .toList()
          ..sort((a, b) => b.id.compareTo(a.id));
    return {
      'items': [
        for (final u in users.take(50))
          {
            'id': u.id,
            'email': u.email,
            'nickname': u.nickname,
            'provider': u.provider,
            'role': u.role,
            'coinBalance': u.coinBalance,
            'monthlyTopupLimit': u.monthlyTopupLimit,
            'drawCount': _db.draws.where((d) => d.userId == u.id).length,
            'createdAt': DemoBackend._iso(u.createdAt),
          },
      ],
    };
  }
}

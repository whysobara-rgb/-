part of 'demo_backend.dart';

/// 계정·보관함·배송.
/// 원본: auth.service.ts, users.service.ts, inventory.service.ts,
/// shipping.service.ts.
extension _AccountHandlers on DemoBackend {
  // ── auth.service.ts ───────────────────────────────────────────────

  static final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');

  Map<String, dynamic> _signup(Map<String, dynamic> body) {
    final c = _Check(body);
    final email = c.string('email');
    if (email != null && !_email.hasMatch(email)) {
      c.errors.add('email must be an email');
    }
    final password = c.string(
      'password',
      minLength: 8,
      maxLength: 64,
      pattern: RegExp(r'(?=.*[A-Za-z])(?=.*\d)'),
      patternMessage:
          'password must contain at least one letter and one number',
    );
    final nickname = c.string('nickname', minLength: 2, maxLength: 20);
    for (final k in [
      'agreeTerms',
      'agreePrivacy',
      'agreeAge14',
      'agreeMarketing',
    ]) {
      c.boolean(k);
    }
    c.done();
    _requireAgreements(body);

    if (_db.users.any((u) => u.email == email)) {
      throw _Fail(409, 10005, 'Email already registered');
    }
    final user = _createAccount(
      body,
      email: email!,
      password: password,
      nickname: nickname!,
    );
    return {
      'accessToken': _issueToken(user),
      'expiresIn': 3600,
      'id': user.id,
      'email': user.email,
      'nickname': user.nickname,
      'welcomeGp': welcomeGp,
      'createdAt': DemoBackend._iso(user.createdAt),
    };
  }

  Map<String, dynamic> _login(Map<String, dynamic> body) {
    final c = _Check(body);
    final email = c.string('email');
    if (email != null && !_email.hasMatch(email)) {
      c.errors.add('email must be an email');
    }
    final password = c.string('password', minLength: 8);
    c.done();

    final user = _db.users
        .where((u) => u.email == email && u.deletedAt == null)
        .firstOrNull;
    if (user == null) {
      throw _Fail(401, 10002, 'Invalid email or password');
    }
    if (user.passwordHash == null) {
      throw _Fail(
        401,
        10002,
        'This account uses social login. Please sign in with the original provider.',
        ['provider:${user.provider}'],
      );
    }
    if (DemoBackend._hashPassword(password!, user.passwordSalt ?? '') !=
        user.passwordHash) {
      throw _Fail(401, 10002, 'Invalid email or password');
    }
    return {
      'accessToken': _issueToken(user),
      'expiresIn': 3600,
      'user': {'id': user.id, 'email': user.email, 'nickname': user.nickname},
    };
  }

  /// 체험판에는 소셜 제공자가 설정돼 있지 않다(GET /auth/providers도 빈 목록).
  Map<String, dynamic> _socialLogin(Map<String, dynamic> body) {
    final c = _Check(body);
    final provider = c.oneOf('provider', ['KAKAO', 'GOOGLE', 'NAVER', 'APPLE']);
    c.string('token', minLength: 10, maxLength: 4096);
    c.done();
    throw _Fail(503, 10012, '$provider login is not available right now');
  }

  void _requireAgreements(Map<String, dynamic> body) {
    if (body['agreeTerms'] != true ||
        body['agreePrivacy'] != true ||
        body['agreeAge14'] != true) {
      throw _Fail(
        400,
        10010,
        'Required agreements (terms, privacy, age 14+) are missing',
        ['agreeTerms', 'agreePrivacy', 'agreeAge14'],
      );
    }
  }

  /// 동의 기록 + 가입 축하 GP.
  DemoUser _createAccount(
    Map<String, dynamic> agreements, {
    required String email,
    required String? password,
    required String nickname,
  }) {
    final salt = _hex(8);
    final user = DemoUser(
      id: _db.nextId('users'),
      email: email,
      passwordSalt: password == null ? null : salt,
      passwordHash: password == null
          ? null
          : DemoBackend._hashPassword(password, salt),
      nickname: nickname,
      coinBalance: welcomeGp,
      termsAgreedAt: _now,
      marketingAgreedAt: agreements['agreeMarketing'] == true ? _now : null,
      createdAt: _now,
    );
    _db.users.add(user);
    _ledger(
      user,
      type: 'EARN',
      reason: 'SIGNUP_BONUS',
      amount: welcomeGp,
      description: '회원가입 축하 GP',
      balanceAfter: welcomeGp,
    );
    return user;
  }

  // ── users.service.ts ──────────────────────────────────────────────

  Map<String, dynamic> _toProfile(DemoUser user) => {
    'id': user.id,
    'email': user.email,
    'nickname': user.nickname,
    'coinBalance': user.coinBalance,
    'provider': user.provider,
    'role': user.role,
    'marketingAgreed': user.marketingAgreedAt != null,
    'createdAt': DemoBackend._iso(user.createdAt),
  };

  Map<String, dynamic> _updateProfile(
    DemoUser user,
    Map<String, dynamic> body,
  ) {
    final c = _Check(body);
    final nickname = c.string(
      'nickname',
      optional: true,
      minLength: 2,
      maxLength: 20,
    );
    final marketing = c.boolean('agreeMarketing');
    c.done();
    if (nickname != null) user.nickname = nickname.trim();
    if (marketing != null) {
      user.marketingAgreedAt = marketing
          ? (user.marketingAgreedAt ?? _now)
          : null;
    }
    return _toProfile(user);
  }

  Map<String, dynamic> _deleteAccount(DemoUser user) {
    final active = _db.shipments
        .where(
          (s) =>
              s.userId == user.id &&
              (s.status == 'REQUESTED' || s.status == 'SHIPPING'),
        )
        .length;
    if (active > 0) {
      throw _Fail(409, 10013, 'Account has shipments in progress', [
        'activeShipments:$active',
      ]);
    }
    final forfeited = user.coinBalance;
    if (forfeited > 0) {
      _ledger(
        user,
        type: 'EXPIRE',
        reason: 'ADJUSTMENT',
        amount: -forfeited,
        description: '회원 탈퇴로 GP 소멸',
        balanceAfter: 0,
      );
    }
    user
      ..email =
          'deleted_${user.id}_${_now.millisecondsSinceEpoch}@deleted.gachivault.invalid'
      ..nickname = '탈퇴회원'
      ..passwordHash = null
      ..passwordSalt = null
      ..coinBalance = 0
      ..marketingAgreedAt = null
      ..monthlyTopupLimit = null
      ..pendingMonthlyTopupLimit = null
      ..pendingTopupLimitEffectiveAt = null
      ..deletedAt = _now;
    return {'deleted': true, 'forfeitedGp': forfeited};
  }

  // ── inventory.service.ts ──────────────────────────────────────────

  Map<String, dynamic> _inventoryRow(DemoInventoryItem row) {
    final item = _catalog.items[row.itemId]!;
    return {
      'inventoryItemId': row.id,
      'itemId': item.itemId,
      'name': item.name,
      'rarity': item.rarity,
      'estimatedValue': item.estimatedValue,
      'exchangeValue': exchangeValueOf(item.estimatedValue),
      'imageUrl': item.imageUrl,
      'status': row.status,
      'isLocked': row.isLocked,
      'acquiredAt': DemoBackend._iso(row.createdAt),
    };
  }

  Map<String, dynamic> _listInventory(DemoUser user, Map<String, String> q) {
    final (page, limit) = _paging(q);
    final status = q['status'];
    if (status != null && !InventoryStatus.all.contains(status)) {
      throw DemoBackend._validation([
        'status must be one of the following values: ${InventoryStatus.all.join(', ')}',
      ]);
    }
    // 포인트로 전환한 상품은 status=EXCHANGED로 물을 때만 나온다.
    final rows =
        _db.inventory
            .where(
              (i) =>
                  i.userId == user.id &&
                  (status == null
                      ? i.status != InventoryStatus.exchanged
                      : i.status == status),
            )
            .toList()
          ..sort(_newestFirst);
    return {
      'items': [
        for (final r in DemoBackend._pageOf(rows, page, limit))
          _inventoryRow(r),
      ],
      'page': page,
      'limit': limit,
      'totalCount': rows.length,
    };
  }

  static int _newestFirst(DemoInventoryItem a, DemoInventoryItem b) {
    final byTime = b.createdAt.compareTo(a.createdAt);
    return byTime != 0 ? byTime : b.id.compareTo(a.id);
  }

  /// 요청한 보관함 상품을 모두 찾고, 내 것이고 보관 중인지 확인한다.
  List<DemoInventoryItem> _ownedStoredItems(
    DemoUser user,
    List<int> requested,
    String purpose,
  ) {
    final ids = requested.toSet().toList();
    // 서버의 `id IN (...)` 조회처럼 id 순서.
    final rows = [
      for (final id in ids) ..._db.inventory.where((i) => i.id == id),
    ]..sort((a, b) => a.id.compareTo(b.id));
    if (rows.length != ids.length) {
      throw _Fail(404, 10004, 'One or more inventory items not found');
    }
    for (final row in rows) {
      if (row.userId != user.id) {
        throw _Fail(
          403,
          10003,
          'Inventory item does not belong to the current user',
        );
      }
      if (row.isLocked || row.status != InventoryStatus.stored) {
        throw _Fail(
          409,
          10005,
          'Inventory item ${row.id} is not eligible for $purpose',
        );
      }
    }
    return rows;
  }

  Map<String, dynamic> _exchange(DemoUser user, Map<String, dynamic> body) {
    final c = _Check(body);
    final requested = c.intList(
      'inventoryItemIds',
      maxSize: 100,
      unique: true,
      minEach: 1,
    );
    c.done();
    final rows = _ownedStoredItems(user, requested!, 'exchange');

    final totalGp = rows.fold<int>(
      0,
      (s, r) => s + exchangeValueOf(_catalog.items[r.itemId]!.estimatedValue),
    );
    for (final row in rows) {
      row
        ..status = InventoryStatus.exchanged
        ..isLocked = true;
    }
    user.coinBalance += totalGp;
    final firstName = _catalog.items[rows.first.itemId]!.name;
    _ledger(
      user,
      type: 'EARN',
      reason: 'EXCHANGE',
      amount: totalGp,
      description: rows.length > 1
          ? '$firstName 외 ${rows.length - 1}개 포인트 전환'
          : '$firstName 포인트 전환',
    );
    return {
      'exchangedItemIds': [for (final r in rows) r.id],
      'totalGp': totalGp,
      'balanceAfter': user.coinBalance,
    };
  }

  // ── shipping.service.ts ───────────────────────────────────────────

  Map<String, dynamic> _createShipping(
    DemoUser user,
    Map<String, dynamic> body,
  ) {
    final c = _Check(body);
    final recipientName = c.string(
      'recipientName',
      minLength: 1,
      maxLength: 100,
    );
    final phone = c.string(
      'phone',
      pattern: RegExp(r'^[0-9-]{9,20}$'),
      patternMessage: 'phone must be a valid phone number',
    );
    final address = c.string('address', minLength: 1, maxLength: 255);
    final notes = c.string('notes', optional: true, maxLength: 500);
    final requested = c.intList('inventoryItemIds');
    c.done();

    if (user.coinBalance < deliveryFee) {
      throw _Fail(400, 10006, 'Insufficient balance for delivery fee');
    }
    final items = _ownedStoredItems(user, requested!, 'shipping');

    user.coinBalance -= deliveryFee;
    _ledger(
      user,
      type: 'USE',
      reason: 'SHIPPING_FEE',
      amount: -deliveryFee,
      description: '배송 신청 배송비',
    );
    final shipment = DemoShipment(
      id: _db.nextId('shipping_requests'),
      userId: user.id,
      recipientName: recipientName!,
      phone: phone!,
      address: address!,
      notes: notes,
      inventoryItemIds: [for (final i in items) i.id],
      createdAt: _now,
      updatedAt: _now,
    );
    _db.shipments.add(shipment);
    for (final item in items) {
      item
        ..status = InventoryStatus.shippingRequested
        ..isLocked = true;
    }
    return {
      'shippingRequestId': shipment.id,
      'recipientName': shipment.recipientName,
      'phone': shipment.phone,
      'address': shipment.address,
      'notes': shipment.notes,
      'status': shipment.status,
      'deliveryFee': deliveryFee,
      'inventoryItemIds': shipment.inventoryItemIds,
      'balanceAfter': user.coinBalance,
      'createdAt': DemoBackend._iso(shipment.createdAt),
    };
  }

  Map<String, dynamic> _listShipping(DemoUser user, Map<String, String> q) {
    final (page, limit) = _paging(q);
    final rows = _db.shipments.where((s) => s.userId == user.id).toList()
      ..sort(_shipmentNewestFirst);
    return {
      'items': [
        for (final s in DemoBackend._pageOf(rows, page, limit))
          {
            'shippingRequestId': s.id,
            'recipientName': s.recipientName,
            'phone': s.phone,
            'address': s.address,
            'notes': s.notes,
            'status': s.status,
            'trackingCompany': s.trackingCompany,
            'trackingNumber': s.trackingNumber,
            'shippedAt': DemoBackend._isoOrNull(s.shippedAt),
            'deliveredAt': DemoBackend._isoOrNull(s.deliveredAt),
            'items': [
              for (final inv in _shipmentItems(s))
                {
                  'inventoryItemId': inv.id,
                  'itemId': inv.itemId,
                  'name': _catalog.items[inv.itemId]!.name,
                  'rarity': _catalog.items[inv.itemId]!.rarity,
                },
            ],
            'createdAt': DemoBackend._iso(s.createdAt),
          },
      ],
      'page': page,
      'limit': limit,
      'totalCount': rows.length,
    };
  }

  static int _shipmentNewestFirst(DemoShipment a, DemoShipment b) {
    final byTime = b.createdAt.compareTo(a.createdAt);
    return byTime != 0 ? byTime : b.id.compareTo(a.id);
  }

  List<DemoInventoryItem> _shipmentItems(DemoShipment s) => [
    for (final id in s.inventoryItemIds)
      ..._db.inventory.where((i) => i.id == id),
  ];
}

/// 체험판 로컬 "DB". 서버 엔티티(`src/entities/*.ts`)에서 앱이 쓰는 열만 둔다.
///
/// 통째로 JSON 하나로 저장한다(시각은 epoch ms).
library;

DateTime? _date(Object? v) => v == null
    ? null
    : DateTime.fromMillisecondsSinceEpoch((v as num).toInt(), isUtc: true);
int? _ms(DateTime? d) => d?.millisecondsSinceEpoch;
int _int(Object? v) => (v as num).toInt();
int? _intOrNull(Object? v) => v == null ? null : (v as num).toInt();

class DemoUser {
  final int id;
  String email;
  String? passwordHash;
  String? passwordSalt;
  String nickname;
  int coinBalance;

  /// USER / ADMIN.
  String role;
  String provider;
  int? monthlyTopupLimit;
  int? pendingMonthlyTopupLimit;
  DateTime? pendingTopupLimitEffectiveAt;
  DateTime? termsAgreedAt;
  DateTime? marketingAgreedAt;
  DateTime? deletedAt;
  final DateTime createdAt;

  DemoUser({
    required this.id,
    required this.email,
    required this.nickname,
    required this.coinBalance,
    required this.createdAt,
    this.passwordHash,
    this.passwordSalt,
    this.role = 'USER',
    this.provider = 'EMAIL',
    this.monthlyTopupLimit,
    this.pendingMonthlyTopupLimit,
    this.pendingTopupLimitEffectiveAt,
    this.termsAgreedAt,
    this.marketingAgreedAt,
    this.deletedAt,
  });

  factory DemoUser.fromJson(Map<String, dynamic> j) => DemoUser(
    id: _int(j['id']),
    email: j['email'] as String,
    passwordHash: j['passwordHash'] as String?,
    passwordSalt: j['passwordSalt'] as String?,
    nickname: j['nickname'] as String,
    coinBalance: _int(j['coinBalance']),
    role: j['role'] as String? ?? 'USER',
    provider: j['provider'] as String? ?? 'EMAIL',
    monthlyTopupLimit: _intOrNull(j['monthlyTopupLimit']),
    pendingMonthlyTopupLimit: _intOrNull(j['pendingMonthlyTopupLimit']),
    pendingTopupLimitEffectiveAt: _date(j['pendingTopupLimitEffectiveAt']),
    termsAgreedAt: _date(j['termsAgreedAt']),
    marketingAgreedAt: _date(j['marketingAgreedAt']),
    deletedAt: _date(j['deletedAt']),
    createdAt: _date(j['createdAt'])!,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'email': email,
    'passwordHash': passwordHash,
    'passwordSalt': passwordSalt,
    'nickname': nickname,
    'coinBalance': coinBalance,
    'role': role,
    'provider': provider,
    'monthlyTopupLimit': monthlyTopupLimit,
    'pendingMonthlyTopupLimit': pendingMonthlyTopupLimit,
    'pendingTopupLimitEffectiveAt': _ms(pendingTopupLimitEffectiveAt),
    'termsAgreedAt': _ms(termsAgreedAt),
    'marketingAgreedAt': _ms(marketingAgreedAt),
    'deletedAt': _ms(deletedAt),
    'createdAt': _ms(createdAt),
  };
}

class DemoDraw {
  final int id;
  final int userId;
  final int gachaId;
  final int spent;
  final bool isPity;
  final bool isBonus;
  final DateTime createdAt;

  const DemoDraw({
    required this.id,
    required this.userId,
    required this.gachaId,
    required this.spent,
    required this.isPity,
    required this.isBonus,
    required this.createdAt,
  });

  factory DemoDraw.fromJson(Map<String, dynamic> j) => DemoDraw(
    id: _int(j['id']),
    userId: _int(j['u']),
    gachaId: _int(j['g']),
    spent: _int(j['s']),
    isPity: j['p'] == 1,
    isBonus: j['b'] == 1,
    createdAt: _date(j['t'])!,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'u': userId,
    'g': gachaId,
    's': spent,
    'p': isPity ? 1 : 0,
    'b': isBonus ? 1 : 0,
    't': _ms(createdAt),
  };
}

/// 서버 InventoryStatus.
abstract final class InventoryStatus {
  static const stored = 'STORED';
  static const shippingRequested = 'SHIPPING_REQUESTED';
  static const shipping = 'SHIPPING';
  static const delivered = 'DELIVERED';
  static const exchanged = 'EXCHANGED';
  static const all = [
    stored,
    shippingRequested,
    shipping,
    delivered,
    exchanged,
  ];
}

class DemoInventoryItem {
  final int id;
  final int userId;
  final int itemId;
  final int drawId;
  String status;
  bool isLocked;
  final DateTime createdAt;

  DemoInventoryItem({
    required this.id,
    required this.userId,
    required this.itemId,
    required this.drawId,
    required this.createdAt,
    this.status = InventoryStatus.stored,
    this.isLocked = false,
  });

  factory DemoInventoryItem.fromJson(Map<String, dynamic> j) =>
      DemoInventoryItem(
        id: _int(j['id']),
        userId: _int(j['u']),
        itemId: _int(j['i']),
        drawId: _int(j['d']),
        status: j['st'] as String,
        isLocked: j['l'] == 1,
        createdAt: _date(j['t'])!,
      );

  Map<String, dynamic> toJson() => {
    'id': id,
    'u': userId,
    'i': itemId,
    'd': drawId,
    'st': status,
    'l': isLocked ? 1 : 0,
    't': _ms(createdAt),
  };
}

/// 서버 WalletTransaction (포인트 내역).
class DemoLedgerEntry {
  final int id;
  final int userId;

  /// EARN / USE / EXPIRE.
  final String type;

  /// TOPUP / BONUS / SIGNUP_BONUS / ATTENDANCE / EXCHANGE / DRAW /
  /// SHIPPING_FEE / ADJUSTMENT.
  final String? reason;
  final int amount;
  final String description;
  final int balanceAfter;
  final DateTime createdAt;

  const DemoLedgerEntry({
    required this.id,
    required this.userId,
    required this.type,
    required this.reason,
    required this.amount,
    required this.description,
    required this.balanceAfter,
    required this.createdAt,
  });

  factory DemoLedgerEntry.fromJson(Map<String, dynamic> j) => DemoLedgerEntry(
    id: _int(j['id']),
    userId: _int(j['u']),
    type: j['ty'] as String,
    reason: j['r'] as String?,
    amount: _int(j['a']),
    description: j['de'] as String,
    balanceAfter: _int(j['ba']),
    createdAt: _date(j['t'])!,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'u': userId,
    'ty': type,
    'r': reason,
    'a': amount,
    'de': description,
    'ba': balanceAfter,
    't': _ms(createdAt),
  };
}

class DemoCheckin {
  final int userId;
  final String checkinDate;
  final int streakDay;
  final int reward;

  const DemoCheckin({
    required this.userId,
    required this.checkinDate,
    required this.streakDay,
    required this.reward,
  });

  factory DemoCheckin.fromJson(Map<String, dynamic> j) => DemoCheckin(
    userId: _int(j['u']),
    checkinDate: j['d'] as String,
    streakDay: _int(j['s']),
    reward: _int(j['r']),
  );

  Map<String, dynamic> toJson() => {
    'u': userId,
    'd': checkinDate,
    's': streakDay,
    'r': reward,
  };
}

class DemoShipment {
  final int id;
  final int userId;
  final String recipientName;
  final String phone;
  final String address;
  final String? notes;

  /// REQUESTED / SHIPPING / DELIVERED.
  String status;
  String? trackingCompany;
  String? trackingNumber;
  DateTime? shippedAt;
  DateTime? deliveredAt;
  final List<int> inventoryItemIds;
  final DateTime createdAt;
  DateTime updatedAt;

  DemoShipment({
    required this.id,
    required this.userId,
    required this.recipientName,
    required this.phone,
    required this.address,
    required this.notes,
    required this.inventoryItemIds,
    required this.createdAt,
    required this.updatedAt,
    this.status = 'REQUESTED',
    this.trackingCompany,
    this.trackingNumber,
    this.shippedAt,
    this.deliveredAt,
  });

  factory DemoShipment.fromJson(Map<String, dynamic> j) => DemoShipment(
    id: _int(j['id']),
    userId: _int(j['u']),
    recipientName: j['rn'] as String,
    phone: j['ph'] as String,
    address: j['ad'] as String,
    notes: j['no'] as String?,
    status: j['st'] as String,
    trackingCompany: j['tc'] as String?,
    trackingNumber: j['tn'] as String?,
    shippedAt: _date(j['sa']),
    deliveredAt: _date(j['da']),
    inventoryItemIds: (j['items'] as List).map(_int).toList(),
    createdAt: _date(j['t'])!,
    updatedAt: _date(j['ut'])!,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'u': userId,
    'rn': recipientName,
    'ph': phone,
    'ad': address,
    'no': notes,
    'st': status,
    'tc': trackingCompany,
    'tn': trackingNumber,
    'sa': _ms(shippedAt),
    'da': _ms(deliveredAt),
    'items': inventoryItemIds,
    't': _ms(createdAt),
    'ut': _ms(updatedAt),
  };
}

/// 서버 PaymentOrder.
class DemoOrder {
  final int id;
  final String orderId;
  final int userId;
  final String packageId;
  final int amount;
  final int gp;
  final int bonusGp;
  int firstTopupBonusGp;

  /// READY / IN_PROGRESS / DONE / FAILED / CANCELED.
  String status;
  String? paymentKey;
  String? method;
  String? failureReason;
  DateTime? approvedAt;
  final DateTime createdAt;
  DateTime updatedAt;

  DemoOrder({
    required this.id,
    required this.orderId,
    required this.userId,
    required this.packageId,
    required this.amount,
    required this.gp,
    required this.bonusGp,
    required this.createdAt,
    required this.updatedAt,
    this.firstTopupBonusGp = 0,
    this.status = 'READY',
    this.paymentKey,
    this.method,
    this.failureReason,
    this.approvedAt,
  });

  factory DemoOrder.fromJson(Map<String, dynamic> j) => DemoOrder(
    id: _int(j['id']),
    orderId: j['oid'] as String,
    userId: _int(j['u']),
    packageId: j['pkg'] as String,
    amount: _int(j['amt']),
    gp: _int(j['gp']),
    bonusGp: _int(j['bgp']),
    firstTopupBonusGp: _int(j['fgp']),
    status: j['st'] as String,
    paymentKey: j['pk'] as String?,
    method: j['m'] as String?,
    failureReason: j['fr'] as String?,
    approvedAt: _date(j['aa']),
    createdAt: _date(j['t'])!,
    updatedAt: _date(j['ut'])!,
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'oid': orderId,
    'u': userId,
    'pkg': packageId,
    'amt': amount,
    'gp': gp,
    'bgp': bonusGp,
    'fgp': firstTopupBonusGp,
    'st': status,
    'pk': paymentKey,
    'm': method,
    'fr': failureReason,
    'aa': _ms(approvedAt),
    't': _ms(createdAt),
    'ut': _ms(updatedAt),
  };
}

/// 박스의 판매 상태(운영자가 바꿀 수 있는 값 + 로컬 판매량).
class DemoGachaState {
  bool active;
  int totalStock;

  /// 체험판에서 실제로 열린 수(보너스 포함). 0부터 센다.
  int soldCount;

  DemoGachaState({
    required this.active,
    required this.totalStock,
    this.soldCount = 0,
  });

  factory DemoGachaState.fromJson(Map<String, dynamic> j) => DemoGachaState(
    active: j['a'] == 1,
    totalStock: _int(j['ts']),
    soldCount: _int(j['sc']),
  );

  Map<String, dynamic> toJson() => {
    'a': active ? 1 : 0,
    'ts': totalStock,
    'sc': soldCount,
  };
}

/// 서버 Banner.
class DemoBanner {
  final int id;
  String title;
  String? subtitle;
  String? badge;
  String? imageUrl;
  String? accentColorHex;
  String linkType;
  String? linkTarget;
  int priority;
  bool active;
  DateTime? startsAt;
  DateTime? endsAt;

  DemoBanner({
    required this.id,
    required this.title,
    this.subtitle,
    this.badge,
    this.imageUrl,
    this.accentColorHex,
    this.linkType = 'NONE',
    this.linkTarget,
    this.priority = 100,
    this.active = true,
    this.startsAt,
    this.endsAt,
  });

  /// 스냅샷의 `GET /banners` 항목에서.
  factory DemoBanner.fromApi(Map<String, dynamic> j) {
    final link = (j['link'] as Map?)?.cast<String, dynamic>() ?? const {};
    DateTime? iso(Object? v) => v == null ? null : DateTime.parse('$v').toUtc();
    return DemoBanner(
      id: _int(j['id']),
      title: j['title'] as String,
      subtitle: j['subtitle'] as String?,
      badge: j['badge'] as String?,
      imageUrl: j['imageUrl'] as String?,
      accentColorHex: j['accentColorHex'] as String?,
      linkType: link['type'] as String? ?? 'NONE',
      linkTarget: link['target'] as String?,
      priority: _intOrNull(j['priority']) ?? 100,
      active: j['active'] as bool? ?? true,
      startsAt: iso(j['startsAt']),
      endsAt: iso(j['endsAt']),
    );
  }

  factory DemoBanner.fromJson(Map<String, dynamic> j) => DemoBanner(
    id: _int(j['id']),
    title: j['title'] as String,
    subtitle: j['subtitle'] as String?,
    badge: j['badge'] as String?,
    imageUrl: j['imageUrl'] as String?,
    accentColorHex: j['accentColorHex'] as String?,
    linkType: j['linkType'] as String,
    linkTarget: j['linkTarget'] as String?,
    priority: _int(j['priority']),
    active: j['active'] == 1,
    startsAt: _date(j['startsAt']),
    endsAt: _date(j['endsAt']),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'subtitle': subtitle,
    'badge': badge,
    'imageUrl': imageUrl,
    'accentColorHex': accentColorHex,
    'linkType': linkType,
    'linkTarget': linkTarget,
    'priority': priority,
    'active': active ? 1 : 0,
    'startsAt': _ms(startsAt),
    'endsAt': _ms(endsAt),
  };
}

/// 체험판 전체 상태.
class DemoState {
  static const int schemaVersion = 1;

  final List<DemoUser> users;
  final List<DemoDraw> draws;
  final List<DemoInventoryItem> inventory;
  final List<DemoLedgerEntry> ledger;
  final List<DemoCheckin> checkins;
  final List<DemoShipment> shipments;
  final List<DemoOrder> orders;
  final List<DemoBanner> banners;
  final Map<int, DemoGachaState> gachas;

  /// '$userId:$gachaId' → 마지막 SSR 이후 뽑은 수.
  final Map<String, int> pity;

  /// 액세스 토큰 → userId.
  final Map<String, int> sessions;

  /// 테이블별 마지막 id.
  final Map<String, int> sequences;

  DemoState({
    List<DemoUser>? users,
    List<DemoDraw>? draws,
    List<DemoInventoryItem>? inventory,
    List<DemoLedgerEntry>? ledger,
    List<DemoCheckin>? checkins,
    List<DemoShipment>? shipments,
    List<DemoOrder>? orders,
    List<DemoBanner>? banners,
    Map<int, DemoGachaState>? gachas,
    Map<String, int>? pity,
    Map<String, int>? sessions,
    Map<String, int>? sequences,
  }) : users = users ?? [],
       draws = draws ?? [],
       inventory = inventory ?? [],
       ledger = ledger ?? [],
       checkins = checkins ?? [],
       shipments = shipments ?? [],
       orders = orders ?? [],
       banners = banners ?? [],
       gachas = gachas ?? {},
       pity = pity ?? {},
       sessions = sessions ?? {},
       sequences = sequences ?? {};

  /// 다음 id(서버의 serial처럼 1부터).
  int nextId(String table) => sequences[table] = (sequences[table] ?? 0) + 1;

  factory DemoState.fromJson(Map<String, dynamic> j) {
    List<T> list<T>(String key, T Function(Map<String, dynamic>) f) =>
        ((j[key] as List?) ?? const [])
            .map((e) => f((e as Map).cast<String, dynamic>()))
            .toList();
    Map<String, int> ints(String key) => ((j[key] as Map?) ?? const {}).map(
      (k, v) => MapEntry(k as String, _int(v)),
    );
    return DemoState(
      users: list('users', DemoUser.fromJson),
      draws: list('draws', DemoDraw.fromJson),
      inventory: list('inventory', DemoInventoryItem.fromJson),
      ledger: list('ledger', DemoLedgerEntry.fromJson),
      checkins: list('checkins', DemoCheckin.fromJson),
      shipments: list('shipments', DemoShipment.fromJson),
      orders: list('orders', DemoOrder.fromJson),
      banners: list('banners', DemoBanner.fromJson),
      gachas: ((j['gachas'] as Map?) ?? const {}).map(
        (k, v) => MapEntry(
          int.parse(k as String),
          DemoGachaState.fromJson((v as Map).cast<String, dynamic>()),
        ),
      ),
      pity: ints('pity'),
      sessions: ints('sessions'),
      sequences: ints('sequences'),
    );
  }

  Map<String, dynamic> toJson() => {
    'version': schemaVersion,
    'users': [for (final u in users) u.toJson()],
    'draws': [for (final d in draws) d.toJson()],
    'inventory': [for (final i in inventory) i.toJson()],
    'ledger': [for (final l in ledger) l.toJson()],
    'checkins': [for (final c in checkins) c.toJson()],
    'shipments': [for (final s in shipments) s.toJson()],
    'orders': [for (final o in orders) o.toJson()],
    'banners': [for (final b in banners) b.toJson()],
    'gachas': gachas.map((k, v) => MapEntry('$k', v.toJson())),
    'pity': pity,
    'sessions': sessions,
    'sequences': sequences,
  };
}

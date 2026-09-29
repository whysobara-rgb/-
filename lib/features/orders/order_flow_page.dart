import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/app_colors.dart';
import '../../shared/providers/auth_provider.dart';
import '../../shared/widgets/balance_notice.dart';
import '../../shared/widgets/gachi_components.dart';
import '../../shared/widgets/gachi_opening.dart';
import '../inventory/presentation/inventory_page.dart';
import 'order_models.dart';
import 'single_opening_view.dart';
import 'purchase_completion_view.dart';
import 'order_repository.dart';
import 'batch_opening.dart';
import 'batch_opening_page.dart';

class OrderFlowPage extends StatefulWidget {
  final int userId;
  final int? gachaId;
  final String title;
  final int initialQuantity;
  final OrderRepository? repository;
  const OrderFlowPage({
    super.key,
    required this.userId,
    this.gachaId,
    this.title = '미개봉 보관함',
    this.initialQuantity = 1,
    this.repository,
  });
  @override
  State<OrderFlowPage> createState() => _OrderFlowPageState();
}

class _OrderFlowPageState extends State<OrderFlowPage> {
  OrderRepository? _repo;
  Odds? _odds;
  PendingPurchase? _pending;
  String? _pendingOpen;
  Receipt? _receipt, _focusedOrder;
  Receipt? _recentPurchase;
  bool _onlyRecentPurchase = false;
  Capsule? _focused;
  Opening? _opening;
  List<Capsule> _capsules = [];
  final Set<String> _selectedCapsules = {};
  BatchOpening? _batchPending;
  int _page = 1, _total = 0, _quantity = 1;
  bool _active = false;
  bool _busy = true,
      _accepted = false,
      _showInventory = false,
      _canRetryOpen = false;
  String? _error;
  String? _openingId;
  bool get _sameUser =>
      context.read<AuthProvider>().currentUser?.id == widget.userId;
  @override
  void initState() {
    super.initState();
    _quantity = widget.initialQuantity.clamp(1, 100);
    _showInventory = widget.gachaId == null;
    WidgetsBinding.instance.addPostFrameCallback((_) => _run(_load));
  }

  Future<void> _run(
    Future<void> Function() action, {
    bool showProgress = true,
  }) async {
    if (!mounted || !_sameUser || _active) return;
    _active = true;
    setState(() {
      _busy = showProgress;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = e is ApiException
              ? e.message
              : '정보를 확인하지 못했습니다. 다시 시도해주세요',
        );
      }
    } finally {
      _active = false;
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _load() async {
    if (!_showInventory) {
      _accepted = false;
      _odds = null;
    }
    _repo ??= widget.repository ?? await OrderRepository.forUser(widget.userId);
    if (!mounted || !_sameUser) return;
    _pending = await _repo!.pendingPurchase();
    _pendingOpen = await _repo!.pendingOpening();
    _batchPending = await _repo!.pendingBatch();
    if (_showInventory) {
      final (items, total) = await _repo!.capsules(_page);
      _capsules = items;
      _total = total;
    } else if (_pending == null) {
      _odds = await _repo!.odds(widget.gachaId!);
      if (mounted && _sameUser) {
        await context.read<AuthProvider>().refreshProfile();
      }
    }
  }

  Future<void> _buy({bool retry = false}) async {
    if (_busy || (!retry && (!_accepted || _odds == null))) return;
    await _run(() async {
      try {
        _receipt = retry
            ? await _repo!.retryPurchase()
            : await _repo!.purchase(_odds!, _quantity, widget.title);
      } catch (_) {
        // After any rejected quote, require a new quote and explicit review.
        _accepted = false;
        _odds = null;
        rethrow;
      } finally {
        _pending = await _repo!.pendingPurchase();
      }
      if (mounted && _sameUser) {
        await context.read<AuthProvider>().refreshProfile();
      }
    });
  }

  Future<void> _recoverOpening(String id) async {
    if (_knownCapsule(id)?.isRefunded == true) return;
    _openingId = id;
    _opening = null;
    _canRetryOpen = false;
    await _run(() async {
      try {
        _opening = await _repo!.result(id);
      } on ApiException catch (e) {
        if (e.httpStatusCode == 409 && e.statusCode == 10005) {
          _canRetryOpen = _knownCapsule(id)?.canOpen ?? true;
        }
        rethrow;
      }
    });
  }

  Future<void> _open(String id) async {
    if (_busy || _knownCapsule(id)?.canOpen == false) return;
    await _run(() async {
      _openingId = id;
      _canRetryOpen = false;
      try {
        _opening = await _repo!.open(id);
      } finally {
        _pendingOpen = await _repo!.pendingOpening();
      }
    });
  }

  Future<void> _viewCapsule(Capsule capsule) async {
    await _run(() async {
      final order = await _repo!.order(capsule.orderId);
      if (!mounted || !_sameUser) return;
      final current = order.capsules.where((c) => c.id == capsule.id);
      if (current.length != 1) invalidResponse();
      _focusedOrder = order;
      if (_recentPurchase?.id == order.id) _recentPurchase = order;
      // The list may predate a refund in another session. Use the current
      // order's capsule state, not the cached unopened-list item.
      _focused = current.single;
      for (final c in order.capsules.where((c) => !c.canOpen)) {
        _selectedCapsules.remove(c.id);
      }
    });
  }

  Capsule? _knownCapsule(String id) {
    for (final order in [_focusedOrder, _receipt]) {
      if (order == null) continue;
      for (final capsule in order.capsules) {
        if (capsule.id == id) return capsule;
      }
    }
    return null;
  }

  void _selectCapsule(String id) {
    if (_busy || _pendingOpen != null || _batchPending != null) return;
    setState(() {
      if (_selectedCapsules.contains(id)) {
        _selectedCapsules.remove(id);
      } else if (_selectedCapsules.length < 100) {
        _selectedCapsules.add(id);
      }
    });
  }

  // Scope changes deliberately reset selection; pagination within a scope does not.
  void _changeSelectionScope(bool recent) {
    if (_busy || _onlyRecentPurchase == recent) return;
    setState(() {
      _onlyRecentPurchase = recent;
      _selectedCapsules.clear();
    });
  }

  Widget _selectionScopeChip(String label, {required bool recent}) {
    final selected = _onlyRecentPurchase == recent;
    return ChoiceChip(
      label: Text(label),
      selected: selected,
      backgroundColor: GachiOpeningColors.panel,
      selectedColor: GachiColors.gold,
      labelStyle: GachiType.meta.copyWith(
        color: selected ? GachiColors.navy : GachiColors.ivory,
      ),
      onSelected: _busy ? null : (_) => _changeSelectionScope(recent),
    );
  }

  String get _selectionScope => _onlyRecentPurchase ? '이번 구매' : '전체 미개봉';

  String get _selectionSummary {
    final visible = _visibleCapsules.map((c) => c.id).toSet();
    final elsewhere = _selectedCapsules
        .where((id) => !visible.contains(id))
        .length;
    return '$_selectionScope에서 ${_selectedCapsules.length}개 선택'
        '${elsewhere == 0 ? '' : ' · 다른 페이지 $elsewhere개 포함'}';
  }

  Future<void> _batchPage({bool resume = false}) async {
    if (_busy || !_sameUser) return;
    final ids = List<String>.of(_selectedCapsules);
    if (!resume && ids.isEmpty) return;
    await _run(() async {
      if (!resume) {
        final agreed = await showDialog<bool>(
          context: context,
          builder: (context) => GachiOpeningTheme(
            child: AlertDialog(
              title: Text('박스 ${ids.length}개를 개봉할까요?'),
              content: Text(
                '$_selectionSummary\n\n추가 결제는 0 GP입니다. 구매 당시 확률로 상품이 지급됩니다. 개봉한 박스는 미개봉 상태로 되돌릴 수 없어요. 중간에 멈추면 나머지는 미개봉으로 남습니다.',
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: const Text('돌아가기'),
                ),
                FilledButton(
                  onPressed: () => Navigator.pop(context, true),
                  child: Text('${ids.length}개 개봉'),
                ),
              ],
            ),
          ),
        );
        if (agreed != true || !mounted || !_sameUser) return;
      }
      if (!mounted || !_sameUser) return;
      await Navigator.push(
        context,
        MaterialPageRoute<void>(
          builder: (_) => BatchOpeningPage(
            repository: _repo!,
            initialIds: resume ? null : ids,
          ),
        ),
      );
      if (!mounted || !_sameUser) return;
      _selectedCapsules.clear();
      _onlyRecentPurchase = false;
      _recentPurchase = null;
      setState(() => _busy = true);
      await _load();
    }, showProgress: false);
  }

  Future<void> _inventory({bool selectPurchased = false}) async {
    final purchased = selectPurchased ? _receipt : null;
    await _run(() async {
      if (_opening != null) {
        await _repo!.acknowledgeOpening(_opening!.capsuleId);
      }
      _opening = null;
      _receipt = null;
      _focused = null;
      _focusedOrder = null;
      _openingId = null;
      _showInventory = true;
      _page = 1;
      await _load();
      if (purchased != null && mounted && _sameUser) {
        _recentPurchase = purchased;
        _onlyRecentPurchase = true;
        _selectedCapsules
          ..clear()
          ..addAll(purchased.capsules.where((c) => c.canOpen).map((c) => c.id));
      } else {
        _onlyRecentPurchase = false;
        _recentPurchase = null;
      }
    });
  }

  List<Capsule> get _visibleCapsules => _onlyRecentPurchase
      ? _recentPurchase!.capsules.where((c) => c.canOpen).toList()
      : _capsules;

  Future<void> _showOdds() async {
    final odds = _odds;
    if (odds == null) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: GachiColors.surface,
      builder: (context) => GachiTheme(
        child: FractionallySizedBox(
          heightFactor: .9,
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.all(GachiSpace.lg),
                child: Row(
                  children: [
                    const Expanded(
                      child: Text(
                        '구성 상품 · 확률 · 전환 GP',
                        style: GachiType.section,
                      ),
                    ),
                    IconButton(
                      tooltip: '확률 안내 닫기',
                      onPressed: () => Navigator.pop(context),
                      icon: const Icon(Icons.close),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: ListView.builder(
                  key: const Key('purchase-odds-list'),
                  padding: const EdgeInsets.all(GachiSpace.lg),
                  itemCount: odds.prizes.length,
                  itemBuilder: (_, i) => _prize(odds.prizes[i], odds: true),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _summary(IconData icon, String title, String description) =>
      _showInventory
      ? GachiOpeningHeading(title: title, description: description)
      : Container(
          margin: const EdgeInsets.only(bottom: 20),
          padding: const EdgeInsets.all(24),
          decoration: BoxDecoration(
            color: AppColors.textPrimary,
            borderRadius: BorderRadius.circular(24),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: Colors.white, size: 40),
              const SizedBox(height: 20),
              Text(
                title,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 10),
              Text(
                description,
                style: const TextStyle(color: Color(0xFFDEDEE4), height: 1.6),
              ),
            ],
          ),
        );

  String _gp(int value) =>
      '${value.toString().replaceAllMapped(RegExp(r'(\d)(?=(\d{3})+(?!\d))'), (m) => '${m[1]},')} GP';

  Widget _detail(String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 10),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              color: _showInventory
                  ? GachiOpeningColors.secondary
                  : AppColors.textSecondary,
            ),
          ),
        ),
        const SizedBox(width: 16),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.end,
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
        ),
      ],
    ),
  );

  Widget _button(
    String text,
    VoidCallback? action, {
    bool primary = true,
  }) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: SizedBox(
      width: double.infinity,
      child: primary
          ? FilledButton(onPressed: _busy ? null : action, child: Text(text))
          : OutlinedButton(onPressed: _busy ? null : action, child: Text(text)),
    ),
  );
  Widget _prize(Prize prize, {bool odds = false}) => Card(
    child: Padding(
      padding: const EdgeInsets.all(14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 64,
            child: GachiProductImage(
              url: prize.imageUrl,
              label: prize.name,
              compact: true,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  prize.name,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Text(
                  '${prize.premium ? '프리미엄' : '일반'} · ${prize.displayGrade}',
                ),
                Text('전환 시 ${prize.conversionGP} GP'),
                if (odds)
                  Text(
                    '당첨 확률 ${prize.probability}',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
              ],
            ),
          ),
        ],
      ),
    ),
  );
  List<Widget> _content() {
    if (_opening != null || (_openingId != null && _busy)) {
      return [
        SingleOpeningView(
          key: ValueKey(_openingId),
          opening: _opening,
          onCollection: () => Navigator.of(context).push(
            MaterialPageRoute<void>(builder: (_) => const InventoryPage()),
          ),
          onUnopened: _busy ? null : _inventory,
          onClose: _busy
              ? null
              : () async {
                  await _run(() async {
                    await _repo!.acknowledgeOpening(_opening!.capsuleId);
                    if (mounted) Navigator.pop(context);
                  });
                },
        ),
      ];
    }
    if (_receipt != null && _openingId == null) {
      if (_receipt!.hasRefund) return _refundedReceipt(_receipt!);
      return [
        PurchaseCompletionView(
          receipt: _receipt!,
          onPrepareOpening: _busy
              ? null
              : () => _inventory(selectPurchased: true),
          onLater: _busy ? null : () => Navigator.of(context).pop(),
        ),
        const BalanceNotice(),
      ];
    }
    if (_openingId != null) {
      return [
        const Text(
          '처리 결과 확인 중',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
        const Text('개봉 결과를 불러오고 있어요. 연결이 끊겼다면 아래 버튼으로 이어서 확인해주세요.'),
        _button('저장된 결과 다시 확인', () => _recoverOpening(_openingId!)),
        if (_canRetryOpen) _button('이 캡슐 개봉 다시 요청', () => _open(_openingId!)),
      ];
    }
    if (_focused != null) {
      if (!_focused!.canOpen) {
        return [
          _summary(
            Icons.inventory_2_outlined,
            _focused!.isRefunded ? '환불이 완료된 박스예요' : '이미 개봉한 박스예요',
            _focusedOrder!.title,
          ),
          _detail('주문 상태', _orderState(_focusedOrder!)),
          if (_focused!.isRefunded)
            const Text('환불이 완료되어 다시 개봉할 수 없어요.')
          else
            _button('확정된 개봉 결과 보기', () => _recoverOpening(_focused!.id)),
          _button('보관함으로 돌아가기', _inventory, primary: false),
        ];
      }
      return [
        _summary(
          Icons.inventory_2_outlined,
          '어떤 상품을 만나게 될까요?',
          _focusedOrder!.title,
        ),
        _detail('개봉 수량', '캡슐 1개'),
        _detail('추가 결제', '0 GP'),
        const Text(
          '이 캡슐을 개봉하시겠어요?\n추가 GP 차감 없이 구매 당시 확률로 상품을 지급합니다. 개봉 후에는 미개봉 상태로 되돌릴 수 없습니다.',
        ),
        _button('캡슐 1개 개봉하기', () => _open(_focused!.id)),
        _button('보관함으로 돌아가기', _inventory, primary: false),
      ];
    }
    final widgets = <Widget>[];
    if (_pending != null) {
      widgets.addAll([
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  '확인 중인 구매가 있어요',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                ),
                Text('${_pending!.title} · ${_pending!.body['quantity']}개'),
                const Text('같은 구매 요청으로 결과를 확인합니다. 새로운 구매를 만들지 않습니다.'),
                _button('이전 구매 결과 확인', () => _buy(retry: true)),
              ],
            ),
          ),
        ),
      ]);
    }
    if (_batchPending != null) {
      widgets.add(
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _batchPending!.complete
                      ? '이전 일괄 개봉 결과가 있어요'
                      : '이어서 확인할 일괄 개봉이 있어요',
                  style: const TextStyle(
                    fontWeight: FontWeight.bold,
                    fontSize: 18,
                  ),
                ),
                Text(
                  '${_batchPending!.results.length} / ${_batchPending!.capsuleIds.length}개 확인',
                ),
                _button('일괄 개봉 결과·이어하기', () => _batchPage(resume: true)),
              ],
            ),
          ),
        ),
      );
    }
    if (_pendingOpen != null) {
      widgets.add(_button('이전 개봉 결과 확인', () => _recoverOpening(_pendingOpen!)));
    }
    if (_showInventory) {
      widgets.add(
        _summary(
          Icons.inventory_2_outlined,
          '미개봉 캡슐',
          '아직 열지 않은 설렘 $_total개. 캡슐을 선택해 상품을 확인하세요.',
        ),
      );
      if (_recentPurchase != null) {
        widgets.add(
          Wrap(
            spacing: GachiSpace.sm,
            children: [
              _selectionScopeChip('이번 구매', recent: true),
              _selectionScopeChip('전체 미개봉', recent: false),
            ],
          ),
        );
      }
      widgets.add(
        Text(
          _onlyRecentPurchase ? _recentPurchase!.title : '최대 100개까지 선택할 수 있어요.',
        ),
      );
      widgets.add(
        const Text('범위 변경이나 새로고침 시 선택이 초기화됩니다.'),
      ); // Keep cross-page selection explicit.
      if (!_onlyRecentPurchase && _total > 20) widgets.add(Text('$_page페이지'));
      if (_inlineAction &&
          _selectedCapsules.isNotEmpty &&
          _pendingOpen == null &&
          _batchPending == null) {
        widgets.add(_selectionAction());
      }
      if (_pendingOpen == null && _batchPending == null) {
        widgets.add(
          Wrap(
            spacing: 8,
            children: [
              TextButton(
                onPressed: _busy
                    ? null
                    : () => setState(() {
                        for (final c in _visibleCapsules.where(
                          (c) => c.canOpen,
                        )) {
                          if (_selectedCapsules.length >= 100) break;
                          _selectedCapsules.add(c.id);
                        }
                      }),
                child: const Text('이 페이지 선택'),
              ),
              TextButton(
                onPressed: _busy || _selectedCapsules.isEmpty
                    ? null
                    : () => setState(_selectedCapsules.clear),
                child: const Text('선택 해제'),
              ),
            ],
          ),
        );
      }
      if (_visibleCapsules.isEmpty && !_busy) {
        widgets.add(
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 36),
            child: Text('보관 중인 미개봉 캡슐이 없습니다.'),
          ),
        );
      }
      widgets.addAll(
        _visibleCapsules.map(
          (c) => Card(
            key: ValueKey('unopened-${c.id}'),
            child: ListTile(
              leading: Checkbox(
                value: _selectedCapsules.contains(c.id),
                onChanged:
                    _busy || _pendingOpen != null || _batchPending != null
                    ? null
                    : (_) => _selectCapsule(c.id),
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 10,
              ),
              title: Text(
                _recentPurchase?.id == c.orderId
                    ? _recentPurchase!.title
                    : '미개봉 박스',
              ),
              subtitle: Text('${c.sequence}번째 박스'),
              trailing: IconButton(
                tooltip: '박스 정보 확인',
                icon: const Icon(Icons.info_outline),
                onPressed:
                    _busy || _pendingOpen != null || _batchPending != null
                    ? null
                    : () => _viewCapsule(c),
              ),
              onTap: _busy || _pendingOpen != null || _batchPending != null
                  ? null
                  : () => _selectCapsule(c.id),
            ),
          ),
        ),
      );
      if (!_onlyRecentPurchase && _total > 20) {
        widgets.add(
          Row(
            children: [
              Expanded(
                child: _button(
                  '이전',
                  _page > 1
                      ? () => _run(() async {
                          _page--;
                          await _load();
                        })
                      : null,
                  primary: false,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _button(
                  '다음',
                  _page * 20 < _total
                      ? () => _run(() async {
                          _page++;
                          await _load();
                        })
                      : null,
                  primary: false,
                ),
              ),
            ],
          ),
        );
      }
      widgets.add(
        _button(
          '새로고침',
          () => _run(() async {
            _selectedCapsules.clear();
            _onlyRecentPurchase = false;
            _recentPurchase = null;
            _page = 1;
            await _load();
          }),
          primary: false,
        ),
      );
    } else if (_pending == null && _odds != null) {
      widgets.addAll([
        const Text('구매 전 마지막 확인', style: GachiType.pageTitle),
        const SizedBox(height: GachiSpace.md),
        Text(widget.title, style: GachiType.section),
        _detail('캡슐 1개', _gp(_odds!.price)),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            IconButton(
              onPressed: _busy || _quantity <= 1
                  ? null
                  : () => setState(() {
                      _quantity--;
                      _accepted = false;
                    }),
              icon: const Icon(Icons.remove),
              tooltip: '수량 줄이기',
            ),
            Text('$_quantity개'),
            IconButton(
              onPressed: _busy || _quantity >= 100
                  ? null
                  : () => setState(() {
                      _quantity++;
                      _accepted = false;
                    }),
              icon: const Icon(Icons.add),
              tooltip: '수량 늘리기',
            ),
          ],
        ),
        Text(
          '합계 ${_gp(_odds!.price * _quantity)}',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
        ),
        _detail(
          '보유 GP',
          _gp(context.read<AuthProvider>().currentUser!.coinBalance),
        ),
        const BalanceNotice(),
        const Text(
          '구매 시 GP가 차감되고 미개봉 캡슐이 보관됩니다. 개봉 시 추가 차감은 없어요.',
          style: TextStyle(color: AppColors.textSecondary, height: 1.6),
        ),
        TextButton.icon(
          key: const Key('purchase-odds-disclosure'),
          onPressed: _busy ? null : _showOdds,
          icon: const Icon(Icons.info_outline),
          label: Text('구성 ${_odds!.prizes.length}종 · 확률과 전환 GP 보기'),
        ),
        CheckboxListTile(
          value: _accepted,
          onChanged: _busy
              ? null
              : (value) => setState(() => _accepted = value ?? false),
          title: const Text('상품별 당첨 확률과 전환 GP를 확인했습니다.'),
          controlAffinity: ListTileControlAffinity.leading,
          contentPadding: EdgeInsets.zero,
        ),
        if (_inlineAction) _purchaseAction(),
        _button('최신 조건 다시 확인', () => _run(_load), primary: false),
      ]);
    } else if (_pending == null && !_busy) {
      widgets.add(_button('다시 불러오기', () => _run(_load)));
    }
    return widgets;
  }

  String _orderState(Receipt order) => switch (order.status) {
    'PAID' => '구매 완료',
    'PARTIALLY_REFUNDED' => '일부 환불 완료',
    'REFUNDED' => '전체 환불 완료',
    _ => invalidResponse(),
  };

  List<Widget> _refundedReceipt(Receipt order) => [
    _summary(Icons.receipt_long_outlined, _orderState(order), order.title),
    _detail('구매 수량', '${order.quantity}개'),
    _detail('개봉 완료', '${order.openedCount}개'),
    _detail('환불 완료', '${order.refundedQuantity}개'),
    _detail('아직 미개봉', '${order.unopenedCount}개'),
    const Text('환불된 박스는 다시 개봉할 수 없어요. 이미 받은 상품은 보관함에 유지됩니다.'),
    for (final c in order.capsules)
      if (c.isOpened)
        _button('${c.sequence}번 박스 개봉 결과 보기', () => _recoverOpening(c.id))
      else if (c.canOpen)
        _button('${c.sequence}번 미개봉 박스 확인', () async {
          await _viewCapsule(c);
          if (mounted && _sameUser && _focused?.id == c.id) {
            setState(() => _receipt = null);
          }
        })
      else
        _detail('${c.sequence}번 박스', '환불 완료'),
    _button('미개봉 보관함 보기', _inventory, primary: false),
  ];

  bool get _inlineAction =>
      MediaQuery.textScalerOf(context).scale(15) > 21 ||
      MediaQuery.sizeOf(context).height < 600;

  Widget _purchaseAction() => Padding(
    padding: const EdgeInsets.all(GachiSpace.lg),
    child: _button('GP로 구매하고 보관하기', _accepted ? () => _buy() : null),
  );

  Widget _selectionAction() => Padding(
    padding: const EdgeInsets.all(GachiSpace.lg),
    child: Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          _selectionSummary,
          key: const Key('opening-selection-scope'),
          textAlign: TextAlign.center,
        ),
        const Text('개봉 후에는 미개봉 상태로 되돌릴 수 없어요.', textAlign: TextAlign.center),
        const SizedBox(height: GachiSpace.sm),
        GachiPrimaryButton(
          label: '선택한 ${_selectedCapsules.length}개 개봉 · 0 GP',
          gold: true,
          onPressed: _busy ? null : () => _batchPage(),
        ),
      ],
    ),
  );

  @override
  Widget build(BuildContext context) {
    final sameUser =
        context.watch<AuthProvider>().currentUser?.id == widget.userId;
    final selection =
        sameUser &&
        _showInventory &&
        _selectedCapsules.isNotEmpty &&
        _batchPending == null &&
        _pendingOpen == null &&
        _focused == null &&
        _openingId == null;
    final purchase =
        sameUser &&
        !_showInventory &&
        _receipt == null &&
        _pending == null &&
        _odds != null &&
        _openingId == null;
    final bottomAction = !_inlineAction && (selection || purchase)
        ? SafeArea(
            top: false,
            child: selection ? _selectionAction() : _purchaseAction(),
          )
        : null;
    final body = !sameUser
        ? const Center(child: Text('구매한 계정으로 다시 로그인해주세요.'))
        : Column(
            children: [
              if (_busy && _openingId == null) const LinearProgressIndicator(),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(GachiSpace.page),
                  children: [
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: GachiSpace.lg),
                        child: Semantics(
                          liveRegion: true,
                          child: Text(_error!),
                        ),
                      ),
                    ..._content(),
                  ],
                ),
              ),
            ],
          );
    // Result/recovery can enter from purchase, without switching to inventory.
    // Select the presentation shell from the visible state, not its entry route.
    return _showInventory || _openingId != null
        ? GachiOpeningScaffold(
            title: _openingId == null ? '미개봉 보관함' : '개봉 결과',
            body: body,
            bottomNavigationBar: bottomAction,
          )
        : GachiScaffold(
            title: '구매 확인',
            body: body,
            bottomNavigationBar: bottomAction,
          );
  }
}

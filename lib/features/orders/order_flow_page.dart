import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import 'order_models.dart';
import 'order_repository.dart';

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
  Capsule? _focused;
  Opening? _opening;
  List<Capsule> _capsules = [];
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

  Future<void> _run(Future<void> Function() action) async {
    if (!mounted || !_sameUser || _active) return;
    _active = true;
    setState(() {
      _busy = true;
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
    _repo ??= widget.repository ?? await OrderRepository.forUser(widget.userId);
    if (!mounted || !_sameUser) return;
    _pending = await _repo!.pendingPurchase();
    _pendingOpen = await _repo!.pendingOpening();
    if (_showInventory) {
      final (items, total) = await _repo!.capsules(_page);
      _capsules = items;
      _total = total;
    } else if (_pending == null) {
      _odds = await _repo!.odds(widget.gachaId!);
      _accepted = false;
    }
  }

  Future<void> _buy({bool retry = false}) async {
    if (_busy) return;
    await _run(() async {
      try {
        _receipt = retry
            ? await _repo!.retryPurchase()
            : await _repo!.purchase(_odds!, _quantity, widget.title);
      } finally {
        _pending = await _repo!.pendingPurchase();
      }
      if (mounted && _sameUser) {
        await context.read<AuthProvider>().refreshProfile();
      }
    });
  }

  Future<void> _recoverOpening(String id) async {
    _openingId = id;
    _canRetryOpen = false;
    await _run(() async {
      try {
        _opening = await _repo!.result(id);
      } on ApiException catch (e) {
        if (e.httpStatusCode == 409 && e.statusCode == 10005) {
          _canRetryOpen = true;
        }
        rethrow;
      }
    });
  }

  Future<void> _open(String id) async {
    if (_busy) return;
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
      _focusedOrder = await _repo!.order(capsule.orderId);
      _focused = capsule;
    });
  }

  Future<void> _inventory() async {
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
    });
  }

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
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 64,
              height: 64,
              child: prize.imageUrl == null
                  ? const Icon(Icons.card_giftcard, size: 36)
                  : Image.network(
                      prize.imageUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, error, stack) =>
                          const Icon(Icons.card_giftcard, size: 36),
                    ),
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
                Text('${prize.premium ? '프리미엄' : '일반'} · ${prize.rarity}'),
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
    if (_opening != null) {
      return [
        const Icon(Icons.check_circle_outline, size: 64, color: Colors.green),
        const Text(
          '상품이 보관함에 도착했어요',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
        _prize(_opening!.prize),
        const Text('확인된 개봉 결과입니다. 다시 확인해도 같은 상품이 표시됩니다.'),
        _button('미개봉 보관함으로', _inventory),
        _button('확인하고 돌아가기', () async {
          await _run(() async {
            await _repo!.acknowledgeOpening(_opening!.capsuleId);
            if (mounted) Navigator.pop(context);
          });
        }, primary: false),
      ];
    }
    if (_receipt != null) {
      return [
        const Icon(Icons.inventory_2_outlined, size: 64),
        const Text(
          '구매가 완료됐어요',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
        Text(
          '${_receipt!.title}\n${_receipt!.quantity}개 · ${_receipt!.total} GP',
        ),
        const Text('캡슐은 미개봉 상태로 보관됩니다. 원하는 때에 하나씩 열어보세요.'),
        _button('미개봉 보관함 보기', _inventory),
      ];
    }
    if (_openingId != null) {
      return [
        const Text(
          '개봉 결과 확인',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
        const Text('결과를 확인하기 전에는 다른 캡슐을 열지 않습니다.'),
        _button('저장된 결과 다시 확인', () => _recoverOpening(_openingId!)),
        if (_canRetryOpen) _button('이 캡슐 개봉 다시 요청', () => _open(_openingId!)),
      ];
    }
    if (_focused != null) {
      return [
        Text(
          _focusedOrder!.title,
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
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
    if (_pendingOpen != null) {
      widgets.add(_button('이전 개봉 결과 확인', () => _recoverOpening(_pendingOpen!)));
    }
    if (_showInventory) {
      widgets.add(
        const Text(
          '미개봉 캡슐',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
      );
      widgets.add(Text('총 $_total개 · $_page페이지'));
      if (_capsules.isEmpty && !_busy) {
        widgets.add(
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 36),
            child: Text('보관 중인 미개봉 캡슐이 없습니다.'),
          ),
        );
      }
      widgets.addAll(
        _capsules.map(
          (c) => Card(
            child: ListTile(
              leading: const Icon(Icons.inventory_2_outlined),
              title: Text('미개봉 캡슐 · ${c.sequence}번'),
              subtitle: const Text('상품 정보를 확인하고 개봉하세요'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _busy || _pendingOpen != null
                  ? null
                  : () => _viewCapsule(c),
            ),
          ),
        ),
      );
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
      widgets.add(_button('새로고침', () => _run(_load), primary: false));
    } else if (_pending == null && _odds != null) {
      widgets.addAll([
        Text(
          widget.title,
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
        ),
        const Text('구매 전 확률과 전환 GP를 확인해주세요.\n구매한 캡슐은 미개봉 보관함에 저장됩니다.'),
        ..._odds!.prizes.map((p) => _prize(p, odds: true)),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            IconButton(
              onPressed: _busy || _quantity <= 1
                  ? null
                  : () => setState(() => _quantity--),
              icon: const Icon(Icons.remove),
              tooltip: '수량 줄이기',
            ),
            Text('$_quantity개'),
            IconButton(
              onPressed: _busy || _quantity >= 100
                  ? null
                  : () => setState(() => _quantity++),
              icon: const Icon(Icons.add),
              tooltip: '수량 늘리기',
            ),
          ],
        ),
        Text(
          '합계 ${_odds!.price * _quantity} GP',
          style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
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
        _button('GP로 구매하고 보관하기', _accepted ? () => _buy() : null),
        _button('최신 조건 다시 확인', () => _run(_load), primary: false),
      ]);
    } else if (_pending == null && !_busy) {
      widgets.add(_button('다시 불러오기', () => _run(_load)));
    }
    return widgets;
  }

  @override
  Widget build(BuildContext context) {
    final sameUser =
        context.watch<AuthProvider>().currentUser?.id == widget.userId;
    return Scaffold(
      appBar: AppBar(title: Text(_showInventory ? '미개봉 보관함' : '구매 확인')),
      body: SafeArea(
        child: !sameUser
            ? const Center(child: Text('구매한 계정으로 다시 로그인해주세요.'))
            : Column(
                children: [
                  if (_busy) const LinearProgressIndicator(),
                  Expanded(
                    child: ListView(
                      padding: const EdgeInsets.all(20),
                      children: [
                        if (_error != null)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 16),
                            child: Semantics(
                              liveRegion: true,
                              child: Text(
                                _error!,
                                style: TextStyle(
                                  color: Theme.of(context).colorScheme.error,
                                ),
                              ),
                            ),
                          ),
                        ..._content(),
                      ],
                    ),
                  ),
                ],
              ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../navigation/tab_navigator.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../../core/domain/rarity.dart';
import '../../../shared/widgets/collectible_card.dart';
import '../../../shared/widgets/product_image.dart';
import '../../../shared/widgets/rarity_tag.dart';
import '../../../shared/widgets/ui.dart';
import '../data/inventory_repository.dart';
import '../domain/inventory_item.dart';
import 'delivery_request_page.dart';

/// 보관함 탭.
///
/// 받은 상품을 상태별로 보고, 보관 중인 상품을 골라 배송 신청하거나
/// 포인트로 전환한다. 전환 전에는 받을 GP를 정확히 보여주고 한 번 더 묻는다.
class InventoryPage extends StatefulWidget {
  const InventoryPage({super.key});

  @override
  State<InventoryPage> createState() => _InventoryPageState();
}

class _InventoryPageState extends State<InventoryPage> {
  static const _repository = InventoryRepository();

  List<InventoryItem> _items = const [];
  bool _loading = true;
  String? _error;
  InventoryStatus? _filter;
  InventorySort _sort = InventorySort.recent;
  final Set<int> _selected = {};
  bool _exchanging = false;
  int _seenRevision = -1;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = _items.isEmpty;
      _error = null;
    });
    try {
      final items = await _repository.list();
      if (!mounted) return;
      setState(() {
        _items = items;
        _loading = false;
        _selected.removeWhere(
          (id) => !items.any((i) => i.id == id && i.isActionable),
        );
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.displayMessage;
        _loading = false;
      });
    }
  }

  List<InventoryItem> get _visible {
    final list = _filter == null
        ? [..._items]
        : _items.where((i) => i.status == _filter).toList();
    switch (_sort) {
      case InventorySort.recent:
        list.sort((a, b) => b.acquiredAt.compareTo(a.acquiredAt));
      case InventorySort.valueHigh:
        list.sort((a, b) => b.estimatedValue.compareTo(a.estimatedValue));
      case InventorySort.valueLow:
        list.sort((a, b) => a.estimatedValue.compareTo(b.estimatedValue));
    }
    return list;
  }

  List<InventoryItem> get _selectedItems =>
      _items.where((i) => _selected.contains(i.id)).toList();

  int _count(InventoryStatus? s) =>
      s == null ? _items.length : _items.where((i) => i.status == s).length;

  void _toggle(InventoryItem item) {
    if (!item.isActionable) return;
    setState(
      () => _selected.contains(item.id)
          ? _selected.remove(item.id)
          : _selected.add(item.id),
    );
  }

  void _toggleAll() {
    final actionable = _visible
        .where((i) => i.isActionable)
        .map((i) => i.id)
        .toSet();
    setState(() {
      if (actionable.every(_selected.contains)) {
        _selected.removeAll(actionable);
      } else {
        _selected.addAll(actionable);
      }
    });
  }

  Future<void> _openSort() async {
    final picked = await showAppSheet<InventorySort>(
      context: context,
      title: '정렬',
      builder: (sheet) => Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          for (final s in InventorySort.values)
            MenuRow(
              label: s.label,
              showChevron: false,
              value: s == _sort ? '선택됨' : null,
              onTap: () => Navigator.of(sheet).pop(s),
            ),
          const SizedBox(height: Space.x2),
        ],
      ),
    );
    if (picked != null) setState(() => _sort = picked);
  }

  Future<void> _requestShipping() async {
    final items = _selectedItems;
    if (items.isEmpty) return;
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => DeliveryRequestPage(items: items)),
    );
    if (done == true && mounted) {
      setState(_selected.clear);
      _load();
    }
  }

  Future<void> _exchange() async {
    final items = _selectedItems.where((i) => i.canExchange).toList();
    if (items.isEmpty) {
      showToast(context, '전환할 수 있는 상품이 없어요');
      return;
    }
    final total = items.fold<int>(0, (s, i) => s + (i.exchangeValue ?? 0));
    final value = items.fold<int>(0, (s, i) => s + i.estimatedValue);
    final balance = context.read<GpProvider>().balance;
    final names = items.take(2).map((i) => i.name).join(', ');
    final more = items.length > 2 ? ' 외 ${items.length - 2}개' : '';

    final ok = await showAppSheet<bool>(
      context: context,
      title: '포인트로 전환',
      builder: (sheet) => Padding(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          0,
          Space.gutter,
          Space.x4,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              '$names$more',
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: AppText.callout,
            ),
            const SizedBox(height: Space.x4),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: Space.x4,
                vertical: Space.x2,
              ),
              decoration: const BoxDecoration(
                color: AppColors.surface,
                borderRadius: Radii.card,
              ),
              child: Column(
                children: [
                  InfoRow(label: '상품', value: '${items.length}개'),
                  InfoRow(label: '정가 합계', value: formatWon(value)),
                  InfoRow(
                    label: '받는 GP',
                    value: formatGp(total),
                    valueStyle: AppText.num(
                      AppText.headline,
                    ).copyWith(color: AppColors.brand),
                  ),
                  const Hairline(),
                  InfoRow(label: '전환 후 보유', value: formatGp(balance + total)),
                ],
              ),
            ),
            const SizedBox(height: Space.x3),
            Text(
              '정가의 80%를 GP로 드려요. 전환한 상품은 되돌릴 수 없어요.',
              style: AppText.caption,
            ),
            const SizedBox(height: Space.x5),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(sheet).pop(false),
                    child: const Text('취소'),
                  ),
                ),
                const SizedBox(width: Space.x2),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: () => Navigator.of(sheet).pop(true),
                    child: Text('${formatGp(total)} 받기'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (ok != true || !mounted) return;

    setState(() => _exchanging = true);
    try {
      final result = await _repository.exchange(
        items.map((i) => i.id).toList(),
      );
      if (!mounted) return;
      final auth = context.read<AuthProvider>();
      if (result.balanceAfter != null) {
        auth.applyBalance(result.balanceAfter!);
      } else {
        await auth.refreshProfile();
      }
      if (!mounted) return;
      showToast(context, '${formatGp(result.totalGp)}를 받았어요');
      setState(_selected.clear);
      await _load();
    } on ApiException catch (e) {
      if (mounted) showToast(context, e.displayMessage);
    } finally {
      if (mounted) setState(() => _exchanging = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final revision = context.select<TabNavigator, int>(
      (t) => t.revisionOf(AppTab.inventory),
    );
    if (revision != _seenRevision) {
      final first = _seenRevision == -1;
      _seenRevision = revision;
      if (!first) WidgetsBinding.instance.addPostFrameCallback((_) => _load());
    }

    final visible = _visible;
    final stored = _items
        .where((i) => i.status == InventoryStatus.stored)
        .toList();
    final storedValue = stored.fold<int>(0, (s, i) => s + i.estimatedValue);
    final actionableVisible = visible.where((i) => i.isActionable).toList();
    final allSelected =
        actionableVisible.isNotEmpty &&
        actionableVisible.every((i) => _selected.contains(i.id));

    return Scaffold(
      appBar: AppBar(
        title: const Text('보관함'),
        actions: [
          TextButton.icon(
            onPressed: _openSort,
            iconAlignment: IconAlignment.end,
            icon: const Icon(Icons.expand_more, size: 18),
            label: Text(
              _sort.label,
              style: AppText.callout.copyWith(color: AppColors.text),
            ),
          ),
          const SizedBox(width: Space.x2),
        ],
      ),
      body: _loading
          ? const LoadingView(height: 400)
          : _error != null && _items.isEmpty
          ? ErrorView(message: _error!, onRetry: _load)
          : RefreshIndicator(
              color: AppColors.text,
              onRefresh: _load,
              child: CustomScrollView(
                slivers: [
                  SliverToBoxAdapter(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(
                        Space.gutter,
                        Space.x1,
                        Space.gutter,
                        Space.x4,
                      ),
                      child: _VaultSummary(items: stored, value: storedValue),
                    ),
                  ),
                  SliverToBoxAdapter(
                    child: SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: Space.page,
                      child: Row(
                        children: [
                          for (final f in <InventoryStatus?>[
                            null,
                            InventoryStatus.stored,
                            InventoryStatus.shippingRequested,
                            InventoryStatus.shipping,
                            InventoryStatus.delivered,
                          ]) ...[
                            VaultChip(
                              label: '${f?.label ?? '전체'} ${_count(f)}',
                              selected: _filter == f,
                              onTap: () => setState(() => _filter = f),
                            ),
                            const SizedBox(width: 6),
                          ],
                        ],
                      ),
                    ),
                  ),
                  const SliverToBoxAdapter(child: SizedBox(height: Space.x3)),
                  if (actionableVisible.isNotEmpty)
                    SliverToBoxAdapter(
                      child: InkWell(
                        onTap: _toggleAll,
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(
                            Space.x3,
                            Space.x1,
                            Space.gutter,
                            Space.x1,
                          ),
                          child: Row(
                            children: [
                              Checkbox(
                                value: allSelected,
                                onChanged: (_) => _toggleAll(),
                              ),
                              Text(
                                '보관 중 상품 전체 선택',
                                style: AppText.callout.copyWith(
                                  color: AppColors.text,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  const SliverToBoxAdapter(child: Hairline()),
                  if (visible.isEmpty)
                    SliverToBoxAdapter(
                      child: EmptyView(
                        icon: Icons.inventory_2_outlined,
                        title: _items.isEmpty ? '보관함이 비어 있어요' : '이 상태의 상품이 없어요',
                        message: _items.isEmpty
                            ? '박스를 열면 받은 상품이 여기에 담겨요'
                            : null,
                        action: _items.isEmpty
                            ? OutlinedButton(
                                onPressed: () => context
                                    .read<TabNavigator>()
                                    .select(AppTab.home),
                                style: OutlinedButton.styleFrom(
                                  minimumSize: const Size(0, 40),
                                ),
                                child: const Text('박스 보러 가기'),
                              )
                            : null,
                      ),
                    )
                  else
                    SliverList.separated(
                      itemCount: visible.length,
                      separatorBuilder: (_, _) =>
                          const Hairline(inset: Space.gutter),
                      itemBuilder: (_, i) => _ItemRow(
                        item: visible[i],
                        selected: _selected.contains(visible[i].id),
                        onTap: () => _toggle(visible[i]),
                      ),
                    ),
                  const SliverToBoxAdapter(child: SizedBox(height: Space.x8)),
                ],
              ),
            ),
      bottomNavigationBar: AnimatedSize(
        duration: Motion.normal,
        curve: Motion.curve,
        child: _selected.isEmpty
            ? const SizedBox(width: double.infinity)
            : _SelectionBar(
                items: _selectedItems,
                busy: _exchanging,
                onShip: _requestShipping,
                onExchange: _exchange,
                onClear: () => setState(_selected.clear),
              ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  final InventoryItem item;
  final bool selected;
  final VoidCallback onTap;

  const _ItemRow({
    required this.item,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final actionable = item.isActionable;
    return InkWell(
      onTap: actionable ? onTap : null,
      child: AnimatedContainer(
        duration: Motion.fast,
        color: selected ? AppColors.brandTint : AppColors.canvas,
        padding: const EdgeInsets.fromLTRB(
          Space.x3,
          Space.x3,
          Space.gutter,
          Space.x3,
        ),
        child: Row(
          children: [
            SizedBox(
              width: 40,
              child: actionable
                  ? Checkbox(value: selected, onChanged: (_) => onTap())
                  : const SizedBox.shrink(),
            ),
            SizedBox(
              width: 72,
              height: 72,
              child: RarityFrame(
                rarity: item.rarity,
                radius: 11,
                glow: 0.6,
                holo: item.rarity == Rarity.ssr,
                holoIntensity: 0.45,
                child: ProductImage(
                  url: item.imageUrl,
                  rarity: item.rarity,
                  name: item.name,
                  borderRadius: BorderRadius.zero,
                ),
              ),
            ),
            const SizedBox(width: Space.x3),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      RarityTag(item.rarity, dense: true),
                      if (item.status != InventoryStatus.stored) ...[
                        const SizedBox(width: 4),
                        QuietLabel(
                          item.status.label,
                          color: AppColors.textSecondary,
                        ),
                      ],
                      if (item.isLocked) ...[
                        const SizedBox(width: 4),
                        const Icon(
                          Icons.lock_outline,
                          size: 14,
                          color: AppColors.textTertiary,
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.bodyStrong,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    item.exchangeValue != null
                        ? '정가 ${formatWon(item.estimatedValue)} · 전환 ${formatGp(item.exchangeValue!)}'
                        : '정가 ${formatWon(item.estimatedValue)}',
                    style: AppText.num(AppText.caption),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    '${formatMonthDay(item.acquiredAt)} 획득',
                    style: AppText.num(
                      AppText.caption,
                    ).copyWith(color: AppColors.textTertiary),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SelectionBar extends StatelessWidget {
  final List<InventoryItem> items;
  final bool busy;
  final VoidCallback onShip;
  final VoidCallback onExchange;
  final VoidCallback onClear;

  const _SelectionBar({
    required this.items,
    required this.busy,
    required this.onShip,
    required this.onExchange,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final exchangeTotal = items
        .where((i) => i.canExchange)
        .fold<int>(0, (s, i) => s + (i.exchangeValue ?? 0));
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.canvas,
        border: Border(top: BorderSide(color: AppColors.hairline)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x2,
            Space.gutter,
            Space.x3,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
                children: [
                  Text(
                    '${items.length}개 선택',
                    style: AppText.num(AppText.bodyStrong),
                  ),
                  const Spacer(),
                  TextButton(
                    onPressed: onClear,
                    style: TextButton.styleFrom(
                      minimumSize: const Size(0, 32),
                      padding: const EdgeInsets.symmetric(horizontal: 4),
                    ),
                    child: Text('선택 해제', style: AppText.callout),
                  ),
                ],
              ),
              const SizedBox(height: Space.x1),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: busy ? null : onShip,
                      child: const Text('배송 신청'),
                    ),
                  ),
                  const SizedBox(width: Space.x2),
                  Expanded(
                    child: FilledButton(
                      onPressed: busy || exchangeTotal == 0 ? null : onExchange,
                      style: FilledButton.styleFrom(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                      ),
                      child: busy
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : FittedBox(
                              child: Text(
                                '포인트 전환 ${formatGp(exchangeTotal)}',
                                style: AppText.num(
                                  AppText.headline,
                                ).copyWith(color: AppColors.canvas),
                              ),
                            ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// 보관함 상단: 보관 중 수량·정가 합계(큰 숫자) + 등급 구성 막대.
class _VaultSummary extends StatelessWidget {
  final List<InventoryItem> items;
  final int value;
  const _VaultSummary({required this.items, required this.value});

  @override
  Widget build(BuildContext context) {
    final counts = <Rarity, int>{};
    for (final i in items) {
      counts[i.rarity] = (counts[i.rarity] ?? 0) + 1;
    }
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 14),
      decoration: BoxDecoration(
        borderRadius: Radii.card,
        border: Border.all(color: AppColors.hairline),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.raised,
            AppColors.surface,
            (counts[Rarity.ssr] ?? 0) > 0
                ? AppColors.raritySSR.withValues(alpha: 0.10)
                : AppColors.surface,
          ],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('MY VAULT', style: AppText.eyebrow),
          const SizedBox(height: 6),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: formatNumber(value)),
                      const TextSpan(text: '원', style: TextStyle(fontSize: 17)),
                    ],
                  ),
                  style: AppText.numeral.copyWith(fontSize: 30),
                ),
              ),
              Text(
                '보관 중 ${formatNumber(items.length)}개',
                style: AppText.num(
                  AppText.callout,
                ).copyWith(color: AppColors.text, fontWeight: FontWeight.w700),
              ),
            ],
          ),
          Text('보관 중인 상품의 정가 합계', style: AppText.caption),
          if (items.isNotEmpty) ...[
            const SizedBox(height: 12),
            ClipRRect(
              borderRadius: BorderRadius.circular(3),
              child: SizedBox(
                height: 6,
                child: Row(
                  children: [
                    for (final r in Rarity.values.reversed)
                      if ((counts[r] ?? 0) > 0)
                        Expanded(
                          flex: counts[r]!,
                          child: Container(
                            margin: const EdgeInsets.only(right: 1.5),
                            color: r.color,
                          ),
                        ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              children: [
                for (final r in Rarity.values.reversed)
                  if ((counts[r] ?? 0) > 0)
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        RarityTag(r, dense: true),
                        const SizedBox(width: 4),
                        Text(
                          '${counts[r]}',
                          style: AppText.num(AppText.caption).copyWith(
                            color: AppColors.text,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

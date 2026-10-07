import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/meters.dart';
import '../../../shared/widgets/ui.dart';
import '../data/admin_repository.dart';
import '../domain/admin_forms.dart';
import '../domain/admin_models.dart';
import 'admin_widgets.dart';

/// 박스: 판매 on/off, 회차 수량, 판매량·매출·환급률.
class AdminBoxesTab extends StatefulWidget {
  final AdminRepository repository;
  const AdminBoxesTab({super.key, required this.repository});

  @override
  State<AdminBoxesTab> createState() => _AdminBoxesTabState();
}

class _AdminBoxesTabState extends State<AdminBoxesTab>
    with AutomaticKeepAliveClientMixin {
  List<AdminGacha>? _items;
  String? _error;
  final Map<int, String> _cardErrors = {};
  final Set<int> _busy = {};

  @override
  bool get wantKeepAlive => true;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final items = await widget.repository.gachas();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.displayMessage);
    }
  }

  void _replace(AdminGacha g) => setState(() {
    _items = [for (final x in _items!) x.id == g.id ? g : x];
  });

  Future<void> _toggle(AdminGacha g, bool active) async {
    setState(() {
      _busy.add(g.id);
      _cardErrors.remove(g.id);
    });
    _replace(g.copyWith(active: active));
    try {
      await widget.repository.updateGacha(g.id, active: active);
      if (mounted) {
        showToast(context, '${g.title} 판매를 ${active ? '켰어요' : '멈췄어요'}');
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      _replace(g); // 되돌린다.
      setState(() => _cardErrors[g.id] = e.displayMessage);
    } finally {
      if (mounted) setState(() => _busy.remove(g.id));
    }
  }

  Future<void> _editStock(AdminGacha g) async {
    final saved = await showAppSheet<int>(
      context: context,
      title: '회차 수량 변경',
      builder: (_) => _StockSheet(gacha: g, repository: widget.repository),
    );
    if (saved != null && mounted) {
      _replace(g.copyWith(totalStock: saved));
      showToast(context, '${g.title} 수량을 ${formatNumber(saved)}개로 바꿨어요');
    }
  }

  @override
  Widget build(BuildContext context) {
    super.build(context);
    final items = _items;
    if (items == null) {
      return _error != null
          ? ErrorView(message: _error!, onRetry: _load)
          : const LoadingView(height: 400);
    }
    final active = items.where((g) => g.active).length;
    return RefreshIndicator(
      color: AppColors.text,
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          Space.x3,
          Space.gutter,
          Space.x10,
        ),
        children: [
          Text(
            '판매 중 $active / 전체 ${items.length} · 환급률은 기대 정가 ÷ 가격(천장 반영)',
            style: AppText.num(AppText.caption),
          ),
          const SizedBox(height: Space.x2),
          for (final g in items) ...[
            _BoxCard(
              gacha: g,
              busy: _busy.contains(g.id),
              error: _cardErrors[g.id],
              onToggle: (v) => _toggle(g, v),
              onEditStock: () => _editStock(g),
            ),
            const SizedBox(height: Space.x2),
          ],
        ],
      ),
    );
  }
}

class _BoxCard extends StatelessWidget {
  final AdminGacha gacha;
  final bool busy;
  final String? error;
  final ValueChanged<bool> onToggle;
  final VoidCallback onEditStock;

  const _BoxCard({
    required this.gacha,
    required this.busy,
    required this.error,
    required this.onToggle,
    required this.onEditStock,
  });

  String _pct(double? v) => v == null ? '-' : '${v.toStringAsFixed(1)}%';

  @override
  Widget build(BuildContext context) {
    final g = gacha;
    return SurfaceCard(
      padding: const EdgeInsets.fromLTRB(12, 8, 6, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Text('#${g.id}', style: AppText.num(AppText.caption)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  g.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.bodyStrong.copyWith(
                    color: g.active ? AppColors.text : AppColors.textTertiary,
                  ),
                ),
              ),
              if (g.soldOut) ...[
                const StatusTag('품절', color: AppColors.danger),
                const SizedBox(width: 4),
              ],
              if (!g.active) ...[
                const StatusTag('판매 중지', color: AppColors.textSecondary),
                const SizedBox(width: 4),
              ],
              Semantics(
                label: '${g.title} 판매',
                toggled: g.active,
                child: Switch(
                  value: g.active,
                  onChanged: busy ? null : onToggle,
                  activeTrackColor: AppColors.brand,
                  activeThumbColor: AppColors.onBrand,
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(right: 6),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                StockBar(
                  total: g.totalStock,
                  sold: g.soldCount,
                  soldOut: g.soldOut,
                  compact: false,
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(child: _Metric('가격', formatGp(g.price))),
                    Expanded(child: _Metric('매출', formatWonShort(g.revenueGp))),
                    Expanded(
                      child: _Metric(
                        '환급률',
                        '${_pct(g.payoutSingle)} / ${_pct(g.payoutMulti)}',
                        note: '1회 / 10+1',
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        '천장 ${formatNumber(g.pityThreshold)}회 · 상품 ${g.itemCount}종',
                        style: AppText.num(AppText.micro),
                      ),
                    ),
                    TextButton(
                      onPressed: busy ? null : onEditStock,
                      style: TextButton.styleFrom(
                        minimumSize: const Size(0, 32),
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        textStyle: AppText.caption.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      child: const Text('수량 변경'),
                    ),
                  ],
                ),
                if (error != null) InlineError(error!),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Metric extends StatelessWidget {
  final String label;
  final String value;
  final String? note;
  const _Metric(this.label, this.value, {this.note});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          note == null ? label : '$label ($note)',
          style: AppText.micro,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        Text(
          value,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: AppText.num(
            AppText.caption,
          ).copyWith(color: AppColors.text, fontWeight: FontWeight.w700),
        ),
      ],
    );
  }
}

class _StockSheet extends StatefulWidget {
  final AdminGacha gacha;
  final AdminRepository repository;
  const _StockSheet({required this.gacha, required this.repository});

  @override
  State<_StockSheet> createState() => _StockSheetState();
}

class _StockSheetState extends State<_StockSheet> {
  late final _controller = TextEditingController(
    text: '${widget.gacha.totalStock}',
  );
  String? _error;
  String? _serverError;
  bool _saving = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final g = widget.gacha;
    final problem = validateTotalStock(
      _controller.text,
      soldCount: g.soldCount,
    );
    setState(() {
      _error = problem;
      _serverError = null;
    });
    if (problem != null) return;
    final value = int.parse(_controller.text.trim());
    setState(() => _saving = true);
    try {
      await widget.repository.updateGacha(g.id, totalStock: value);
      if (mounted) Navigator.of(context).pop(value);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _serverError = e.displayMessage;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final g = widget.gacha;
    return Padding(
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
            '${g.title} · 지금 ${formatNumber(g.totalStock)}개 중 '
            '${formatNumber(g.soldCount)}개 판매',
            style: AppText.caption,
          ),
          const SizedBox(height: Space.x3),
          TextField(
            controller: _controller,
            autofocus: true,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly],
            style: AppText.num(AppText.body),
            decoration: InputDecoration(
              labelText: '회차 총 수량',
              suffixText: '개',
              helperText: '판매된 ${formatNumber(g.soldCount)}개보다 적게 정할 수 없어요',
              errorText: _error,
            ),
          ),
          if (_serverError != null) ...[
            const SizedBox(height: Space.x3),
            InlineError(_serverError!),
          ],
          const SizedBox(height: Space.x4),
          PrimaryButton(label: '저장', loading: _saving, onPressed: _save),
        ],
      ),
    );
  }
}

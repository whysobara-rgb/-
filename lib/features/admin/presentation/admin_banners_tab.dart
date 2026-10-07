import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../data/admin_repository.dart';
import '../domain/admin_forms.dart';
import '../domain/admin_models.dart';
import 'admin_widgets.dart';
import 'banner_form_page.dart';

/// 배너: 목록(비활성 포함), 노출 on/off, 생성·수정.
class AdminBannersTab extends StatefulWidget {
  final AdminRepository repository;
  const AdminBannersTab({super.key, required this.repository});

  @override
  State<AdminBannersTab> createState() => _AdminBannersTabState();
}

class _AdminBannersTabState extends State<AdminBannersTab>
    with AutomaticKeepAliveClientMixin {
  List<AdminBanner>? _items;
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
      final items = await widget.repository.banners();
      if (!mounted) return;
      setState(() {
        _items = items;
        _error = null;
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.displayMessage);
    }
  }

  Future<void> _toggle(AdminBanner b, bool active) async {
    setState(() {
      _busy.add(b.id);
      _cardErrors.remove(b.id);
    });
    try {
      await widget.repository.updateBanner(b.id, {'active': active});
      await _load();
    } on ApiException catch (e) {
      if (mounted) setState(() => _cardErrors[b.id] = e.displayMessage);
    } finally {
      if (mounted) setState(() => _busy.remove(b.id));
    }
  }

  Future<void> _openForm([AdminBanner? banner]) async {
    final saved = await Navigator.of(context).push<bool>(
      BannerFormPage.route(repository: widget.repository, banner: banner),
    );
    if (saved == true && mounted) {
      showToast(context, banner == null ? '배너를 만들었어요' : '배너를 저장했어요');
      _load();
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
    final now = DateTime.now();
    final live = items.where((b) => b.liveAt(now)).length;
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
          Row(
            children: [
              Expanded(
                child: Text(
                  '지금 노출 $live / 전체 ${items.length} · 우선순위 작은 순',
                  style: AppText.num(AppText.caption),
                ),
              ),
              FilledButton.icon(
                onPressed: () => _openForm(),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('새 배너'),
                style: FilledButton.styleFrom(
                  minimumSize: const Size(0, 36),
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  textStyle: AppText.bodyStrong,
                ),
              ),
            ],
          ),
          const SizedBox(height: Space.x3),
          for (final b in items) ...[
            _BannerRow(
              banner: b,
              live: b.liveAt(now),
              busy: _busy.contains(b.id),
              error: _cardErrors[b.id],
              onToggle: (v) => _toggle(b, v),
              onEdit: () => _openForm(b),
            ),
            const SizedBox(height: Space.x2),
          ],
        ],
      ),
    );
  }
}

class _BannerRow extends StatelessWidget {
  final AdminBanner banner;
  final bool live;
  final bool busy;
  final String? error;
  final ValueChanged<bool> onToggle;
  final VoidCallback onEdit;

  const _BannerRow({
    required this.banner,
    required this.live,
    required this.busy,
    required this.error,
    required this.onToggle,
    required this.onEdit,
  });

  @override
  Widget build(BuildContext context) {
    final b = banner;
    final argb = b.accentColorHex == null
        ? null
        : parseHexArgb(b.accentColorHex!);
    final window = [
      b.startsAt == null ? '시작 즉시' : formatDateTime(b.startsAt!),
      b.endsAt == null ? '종료 없음' : formatDateTime(b.endsAt!),
    ].join(' ~ ');
    final link = b.linkType == AdminLinkType.none
        ? '연결 없음'
        : '${b.linkType.label}${b.linkTarget == null ? '' : ' · ${b.linkTarget}'}';
    return Material(
      color: AppColors.surface,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.button,
        side: const BorderSide(color: AppColors.hairline),
      ),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onEdit,
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                width: 6,
                color: argb == null ? AppColors.high : Color(argb),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(10, 8, 0, 8),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Text(
                            'P${b.priority}',
                            style: AppText.num(AppText.micro),
                          ),
                          const SizedBox(width: 6),
                          if (b.badge != null) ...[
                            StatusTag(b.badge!, color: AppColors.textSecondary),
                            const SizedBox(width: 6),
                          ],
                          Expanded(
                            child: Text(
                              b.title,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: AppText.bodyStrong.copyWith(
                                color: b.active
                                    ? AppColors.text
                                    : AppColors.textTertiary,
                              ),
                            ),
                          ),
                        ],
                      ),
                      if (b.subtitle != null)
                        Text(
                          b.subtitle!,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppText.caption,
                        ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          StatusTag(
                            live ? '노출 중' : (b.active ? '기간 밖' : '꺼짐'),
                            color: live
                                ? AppColors.brand
                                : AppColors.textTertiary,
                          ),
                          const SizedBox(width: 6),
                          Expanded(
                            child: Text(
                              '$link · $window',
                              maxLines: 2,
                              style: AppText.num(AppText.micro),
                            ),
                          ),
                        ],
                      ),
                      if (error != null) ...[
                        const SizedBox(height: 6),
                        InlineError(error!),
                      ],
                    ],
                  ),
                ),
              ),
              Center(
                child: Semantics(
                  label: '${b.title} 노출',
                  toggled: b.active,
                  child: Switch(
                    value: b.active,
                    onChanged: busy ? null : onToggle,
                    activeTrackColor: AppColors.brand,
                    activeThumbColor: AppColors.onBrand,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

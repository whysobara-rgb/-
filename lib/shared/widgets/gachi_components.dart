import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../core/design/gachi_tokens.dart';

export '../../core/design/gachi_tokens.dart';

class GachiScaffold extends StatelessWidget {
  final Widget body;
  final Widget? bottomNavigationBar;
  final String? title;
  const GachiScaffold({
    super.key,
    required this.body,
    this.title,
    this.bottomNavigationBar,
  });
  @override
  Widget build(BuildContext context) => GachiTheme(
    child: Scaffold(
      appBar: title == null ? null : AppBar(title: Text(title!)),
      body: SafeArea(
        top: title == null,
        bottom: bottomNavigationBar == null,
        child: body,
      ),
      bottomNavigationBar: bottomNavigationBar,
    ),
  );
}

class GachiHeader extends StatelessWidget {
  final String balance;
  final VoidCallback onWallet;
  final VoidCallback? onSearch, onUpdates;
  const GachiHeader({
    super.key,
    required this.balance,
    required this.onWallet,
    this.onSearch,
    this.onUpdates,
  });
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: GachiSpace.sm),
    child: LayoutBuilder(
      builder: (context, constraints) {
        final large =
            MediaQuery.textScalerOf(context).scale(15) > 21 ||
            constraints.maxWidth < 300 ||
            balance.length > 9;
        final logo = Semantics(
          header: true,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const ExcludeSemantics(
                child: Icon(
                  Icons.token_outlined,
                  color: GachiColors.gold,
                  size: 28,
                ),
              ),
              const SizedBox(width: GachiSpace.sm),
              Text(
                '가치가차',
                style: GachiType.section.copyWith(fontWeight: FontWeight.w800),
              ),
            ],
          ),
        );
        final actions = Wrap(
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            TextButton(
              onPressed: onWallet,
              style: TextButton.styleFrom(
                backgroundColor: GachiColors.divider.withValues(alpha: .45),
              ),
              child: Text(
                '$balance GP',
                style: GachiType.meta.copyWith(
                  color: GachiColors.ink,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
            if (onSearch != null)
              IconButton(
                tooltip: '박스 검색',
                onPressed: onSearch,
                icon: const Icon(Icons.search_rounded),
              ),
            if (onUpdates != null)
              IconButton(
                tooltip: '소식·고객지원',
                onPressed: onUpdates,
                icon: const Icon(Icons.notifications_none_rounded),
              ),
          ],
        );
        return large
            ? Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [logo, actions],
              )
            : Row(
                children: [
                  Expanded(child: logo),
                  actions,
                ],
              );
      },
    ),
  );
}

class GachiPrimaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  final bool gold;
  const GachiPrimaryButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.gold = false,
  });
  @override
  Widget build(BuildContext context) => FilledButton(
    style: gold
        ? FilledButton.styleFrom(
            backgroundColor: GachiColors.gold,
            foregroundColor: GachiColors.navy,
          )
        : null,
    onPressed: onPressed,
    child: Text(label, textAlign: TextAlign.center),
  );
}

class GachiSecondaryButton extends StatelessWidget {
  final String label;
  final VoidCallback? onPressed;
  const GachiSecondaryButton({
    super.key,
    required this.label,
    required this.onPressed,
  });
  @override
  Widget build(BuildContext context) => OutlinedButton(
    onPressed: onPressed,
    child: Text(label, textAlign: TextAlign.center),
  );
}

/// A stable image frame, with no inferred product or alternate photo fallback.
class GachiProductImage extends StatelessWidget {
  final String? url;
  final String label;
  final double aspectRatio;
  final bool compact;
  final ImageProvider? imageProvider;
  final IconData? placeholderIcon;
  const GachiProductImage({
    super.key,
    required this.url,
    required this.label,
    this.aspectRatio = 1.12,
    this.compact = false,
    this.imageProvider,
    this.placeholderIcon,
  });
  Widget _placeholder({bool failed = false}) => ColoredBox(
    color: GachiColors.navy,
    child: Center(
      child: Padding(
        padding: const EdgeInsets.all(GachiSpace.sm),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              placeholderIcon ??
                  (failed
                      ? Icons.hide_image_outlined
                      : Icons.inventory_2_outlined),
              color: GachiColors.gold,
              size: compact ? 22 : 32,
            ),
            if (!compact) ...[
              const SizedBox(height: GachiSpace.sm),
              Text(
                failed ? '사진을 불러오지 못했어요' : '등록된 사진이 없어요',
                textAlign: TextAlign.center,
                style: GachiType.meta.copyWith(color: GachiColors.ivory),
              ),
            ],
          ],
        ),
      ),
    ),
  );
  @override
  Widget build(BuildContext context) => Semantics(
    image: true,
    label: '$label 사진',
    child: ClipRRect(
      borderRadius: GachiShape.card,
      child: AspectRatio(
        aspectRatio: aspectRatio,
        child: url == null || url!.trim().isEmpty
            ? Semantics(label: '등록된 사진 없음', child: _placeholder())
            : imageProvider != null
            ? Image(
                image: imageProvider!,
                fit: BoxFit.contain,
                excludeFromSemantics: true,
                frameBuilder: (context, child, frame, synchronous) =>
                    frame != null || synchronous
                    ? ColoredBox(color: GachiColors.surface, child: child)
                    : const ColoredBox(
                        color: GachiColors.navy,
                        child: Center(
                          child: SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: GachiColors.gold,
                              semanticsLabel: '사진 불러오는 중',
                            ),
                          ),
                        ),
                      ),
                errorBuilder: (_, _, _) => Semantics(
                  label: '사진 로드 실패',
                  child: _placeholder(failed: true),
                ),
              )
            : CachedNetworkImage(
                imageUrl: url!,
                fit: BoxFit.contain,
                imageBuilder: (context, provider) => ColoredBox(
                  color: GachiColors.surface,
                  child: Image(
                    image: provider,
                    fit: BoxFit.contain,
                    excludeFromSemantics: true,
                  ),
                ),
                placeholder: (_, _) => const ColoredBox(
                  color: GachiColors.navy,
                  child: Center(
                    child: SizedBox(
                      width: 24,
                      height: 24,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: GachiColors.gold,
                        semanticsLabel: '사진 불러오는 중',
                      ),
                    ),
                  ),
                ),
                errorWidget: (_, _, _) => Semantics(
                  label: '사진 로드 실패',
                  child: _placeholder(failed: true),
                ),
              ),
      ),
    ),
  );
}

class GachiBadge extends StatelessWidget {
  final String label;
  const GachiBadge({super.key, required this.label});
  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: const BoxDecoration(
      color: GachiColors.navy,
      borderRadius: GachiShape.small,
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      child: Text(
        label,
        style: GachiType.meta.copyWith(
          color: GachiColors.ivory,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

class GachiSectionHeader extends StatelessWidget {
  final String title;
  final String? actionLabel;
  final VoidCallback? onAction;
  const GachiSectionHeader({
    super.key,
    required this.title,
    this.actionLabel,
    this.onAction,
  });
  @override
  Widget build(BuildContext context) => Wrap(
    alignment: WrapAlignment.spaceBetween,
    crossAxisAlignment: WrapCrossAlignment.center,
    spacing: GachiSpace.sm,
    children: [
      Semantics(header: true, child: Text(title, style: GachiType.section)),
      if (onAction != null)
        TextButton(onPressed: onAction, child: Text(actionLabel ?? '전체 보기')),
    ],
  );
}

class GachiInfoCard extends StatelessWidget {
  final Widget child;
  const GachiInfoCard({super.key, required this.child});
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(GachiSpace.lg),
    decoration: BoxDecoration(
      color: GachiColors.surface,
      borderRadius: GachiShape.card,
      border: Border.all(color: GachiColors.divider),
      boxShadow: GachiShape.shadow,
    ),
    child: child,
  );
}

class GachiEmptyState extends StatelessWidget {
  final String title, message;
  final IconData icon;
  final Widget? action;
  const GachiEmptyState({
    super.key,
    required this.title,
    required this.message,
    this.icon = Icons.inventory_2_outlined,
    this.action,
  });
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Padding(
      padding: const EdgeInsets.symmetric(vertical: GachiSpace.section),
      child: Column(
        children: [
          Icon(icon, size: 32, color: GachiColors.muted),
          const SizedBox(height: GachiSpace.lg),
          Text(title, textAlign: TextAlign.center, style: GachiType.section),
          const SizedBox(height: GachiSpace.sm),
          Text(
            message,
            textAlign: TextAlign.center,
            style: GachiType.body.copyWith(color: GachiColors.secondary),
          ),
          if (action != null) ...[
            const SizedBox(height: GachiSpace.md),
            action!,
          ],
        ],
      ),
    ),
  );
}

class GachiLoadingState extends StatelessWidget {
  const GachiLoadingState({super.key});
  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.all(GachiSpace.section),
    child: Center(
      child: CircularProgressIndicator(semanticsLabel: '박스를 불러오는 중'),
    ),
  );
}

class GachiErrorState extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;
  const GachiErrorState({
    super.key,
    required this.message,
    required this.onRetry,
  });
  @override
  Widget build(BuildContext context) => GachiEmptyState(
    icon: Icons.wifi_off_rounded,
    title: '연결을 확인해주세요',
    message: message,
    action: GachiSecondaryButton(label: '다시 불러오기', onPressed: onRetry),
  );
}

class GachiBottomNavigation extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onSelected;
  const GachiBottomNavigation({
    super.key,
    required this.selectedIndex,
    required this.onSelected,
  });
  static const labels = ['홈', '박스샵', '개봉', '보관함', '마이'];
  static const icons = [
    Icons.home_outlined,
    Icons.storefront_outlined,
    Icons.inventory_2_outlined,
    Icons.widgets_outlined,
    Icons.person_outline_rounded,
  ];
  @override
  Widget build(BuildContext context) => GachiTheme(
    child: Material(
      color: GachiColors.surface,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: BorderSide(color: GachiColors.divider)),
        ),
        child: SafeArea(
          top: false,
          minimum: const EdgeInsets.only(bottom: GachiSize.bottomInset),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: List.generate(
              labels.length,
              (i) => Expanded(
                child: Semantics(
                  selected: selectedIndex == i,
                  button: true,
                  label: labels[i],
                  excludeSemantics: true,
                  child: InkWell(
                    onTap: () => onSelected(i),
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(
                        minHeight: GachiSize.touch,
                      ),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          vertical: 8,
                          horizontal: 2,
                        ),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Container(
                              padding: const EdgeInsets.all(6),
                              decoration: BoxDecoration(
                                color: i == 2
                                    ? GachiColors.navy
                                    : Colors.transparent,
                                borderRadius: GachiShape.small,
                              ),
                              child: Icon(
                                icons[i],
                                size: GachiSize.navIcon,
                                color: i == 2
                                    ? GachiColors.gold
                                    : selectedIndex == i
                                    ? GachiColors.ink
                                    : GachiColors.muted,
                              ),
                            ),
                            const SizedBox(height: GachiSpace.xs),
                            Text(
                              labels[i],
                              textAlign: TextAlign.center,
                              style: GachiType.meta.copyWith(
                                color: selectedIndex == i
                                    ? GachiColors.ink
                                    : GachiColors.muted,
                                fontWeight: selectedIndex == i
                                    ? FontWeight.w700
                                    : FontWeight.w500,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

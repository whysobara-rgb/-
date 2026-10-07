import 'package:flutter/material.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../data/gacha_repository.dart';
import '../domain/gacha_models.dart';
import 'odds_page.dart';
import 'widgets/box_thumb.dart';

/// 모든 박스의 확률 공개 화면으로 가는 목록 (MY에서 진입).
class OddsIndexPage extends StatefulWidget {
  const OddsIndexPage({super.key});

  @override
  State<OddsIndexPage> createState() => _OddsIndexPageState();
}

class _OddsIndexPageState extends State<OddsIndexPage> {
  static const _repository = GachaRepository();
  late Future<List<GachaSummary>> _future = _repository.list();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('확률 및 구성 정보')),
      body: FutureBuilder<List<GachaSummary>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const LoadingView();
          }
          if (snap.hasError) {
            final e = snap.error;
            return ErrorView(
              message: e is ApiException ? e.displayMessage : '목록을 불러오지 못했어요',
              onRetry: () => setState(() => _future = _repository.list()),
            );
          }
          final boxes = snap.data ?? const [];
          return ListView.separated(
            itemCount: boxes.length + 1,
            separatorBuilder: (_, i) => i == 0
                ? const SizedBox.shrink()
                : const Hairline(inset: Space.gutter),
            itemBuilder: (context, i) {
              if (i == 0) {
                return Padding(
                  padding: const EdgeInsets.fromLTRB(
                    Space.gutter,
                    Space.x2,
                    Space.gutter,
                    Space.x3,
                  ),
                  child: Text(
                    '박스마다 등급별·상품별 확률과 천장 규칙을 공개해요.',
                    style: AppText.callout,
                  ),
                );
              }
              final box = boxes[i - 1];
              return InkWell(
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => OddsPage(gacha: box)),
                ),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: Space.gutter,
                    vertical: Space.x3,
                  ),
                  child: Row(
                    children: [
                      SizedBox(
                        width: 56,
                        height: 56,
                        child: BoxThumb(
                          box: box,
                          scale: 0.76,
                          borderRadius: Radii.thumb,
                        ),
                      ),
                      const SizedBox(width: Space.x3),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              box.title,
                              style: AppText.bodyStrong.copyWith(
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              [
                                '1회 ${formatGp(box.price)}',
                                box.pityThreshold != null
                                    ? '천장 ${formatNumber(box.pityThreshold!)}회'
                                    : '천장 없음',
                              ].join(' · '),
                              style: AppText.num(AppText.caption),
                            ),
                          ],
                        ),
                      ),
                      const Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: AppColors.textTertiary,
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}

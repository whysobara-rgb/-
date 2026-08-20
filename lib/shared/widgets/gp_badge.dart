import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/theme/app_colors.dart';
import '../providers/gp_provider.dart';

/// AppBar에 표시되는 GP(포인트) 잔액 뱃지.
///
/// Claymorphism & Pastel 3D 스타일 - 노란 오벌 배경 위에
/// 입체감 있는 3D 코인 아이콘 + 잔액 텍스트로 구성된 컴팩트 칩.
class GpBadge extends StatelessWidget {
  const GpBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();

    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: Center(
        child: Container(
          padding: const EdgeInsets.fromLTRB(4, 4, 12, 4),
          decoration: BoxDecoration(
            gradient: AppColors.coinGradient,
            borderRadius: BorderRadius.circular(24),
            boxShadow: [
              BoxShadow(
                color: AppColors.accentYellow.withValues(alpha: 0.45),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
              BoxShadow(
                color: Colors.white.withValues(alpha: 0.6),
                blurRadius: 2,
                offset: const Offset(0, -1),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              // ── 3D 코인 아이콘 ──
              Container(
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    colors: [Color(0xFFFFF3C4), Color(0xFFE8A317)],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  border: Border.all(
                    color: Colors.white.withValues(alpha: 0.8),
                    width: 1,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: const Color(0xFFB8790A).withValues(alpha: 0.5),
                      blurRadius: 2,
                      offset: const Offset(0, 1.5),
                    ),
                  ],
                ),
                alignment: Alignment.center,
                child: const Text(
                  '\$',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w900,
                    color: Color(0xFF8A5A00),
                    height: 1,
                  ),
                ),
              ),
              const SizedBox(width: 6),
              Text(
                '${gp.formattedBalance} GP',
                style: const TextStyle(
                  color: Color(0xFF6B4A00),
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

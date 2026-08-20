import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';

/// 가치가차 - 실시간 당첨 정보를 오른쪽에서 왼쪽으로 무한 스크롤하는
/// marquee 배너.
///
/// 다크 배경(AppColors.darkSurface) 위에 골드 텍스트로 표시되며,
/// AnimationController + Transform.translate로 직접 구현한다.
/// 텍스트를 두 벌 나란히 배치하고, 첫 번째 텍스트 폭만큼 왼쪽으로
/// 이동시킨 뒤 처음 위치로 되돌리면(반복) 끊김 없이 순환하는 것처럼 보인다.
class WinnerTicker extends StatefulWidget {
  const WinnerTicker({super.key});

  @override
  State<WinnerTicker> createState() => _WinnerTickerState();
}

class _WinnerTickerState extends State<WinnerTicker>
    with SingleTickerProviderStateMixin {
  static const String _message =
      '⭐ 김**님 프리미엄 당첨!      ⭐ 박**님 대박 당첨!      ⭐ 이**님 특별 당첨!      ';

  static const TextStyle _textStyle = TextStyle(
    color: AppColors.goldPrimary,
    fontSize: 12,
    fontWeight: FontWeight.w700,
  );

  late final AnimationController _controller;
  double _textWidth = 0;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 14),
    )..repeat();
    _measureText();
  }

  void _measureText() {
    final painter = TextPainter(
      text: const TextSpan(text: _message, style: _textStyle),
      textDirection: TextDirection.ltr,
    )..layout();
    _textWidth = painter.width;
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 32,
      color: AppColors.darkSurface,
      child: ClipRect(
        child: AnimatedBuilder(
          animation: _controller,
          builder: (context, child) {
            final dx = -_controller.value * _textWidth;
            return Stack(
              children: [
                Positioned(
                  left: dx,
                  top: 0,
                  bottom: 0,
                  child: Row(children: const [_TickerText(), _TickerText()]),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _TickerText extends StatelessWidget {
  const _TickerText();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Text(
        _WinnerTickerState._message,
        style: _WinnerTickerState._textStyle,
        softWrap: false,
      ),
    );
  }
}

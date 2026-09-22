import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'gachi_components.dart';

/// V33 midnight surfaces. Scoped here so Stage 1 and deferred pages keep themes.
abstract final class GachiOpeningColors {
  static const panel = Color(0xFF10263A);
  static const border = Color(0xFF5D645C);
  static const secondary = Color(0xFFB8C5D3);
  static const grade = Color(0xFF293C4A);
}

class GachiOpeningTheme extends StatelessWidget {
  final Widget child;
  const GachiOpeningTheme({super.key, required this.child});
  @override
  Widget build(BuildContext context) {
    final base = GachiTheme.data;
    return Theme(
      data: base.copyWith(
        scaffoldBackgroundColor: GachiColors.navy,
        colorScheme: base.colorScheme.copyWith(
          brightness: Brightness.dark,
          primary: GachiColors.gold,
          onPrimary: GachiColors.navy,
          surface: GachiOpeningColors.panel,
          onSurface: GachiColors.ivory,
          error: const Color(0xFFFFB4AB),
        ),
        textTheme: base.textTheme.apply(
          bodyColor: GachiColors.ivory,
          displayColor: GachiColors.ivory,
        ),
        appBarTheme: base.appBarTheme.copyWith(
          backgroundColor: GachiColors.navy,
          foregroundColor: GachiColors.ivory,
          systemOverlayStyle: SystemUiOverlayStyle.light,
          titleTextStyle: GachiType.section.copyWith(color: GachiColors.ivory),
        ),
        iconTheme: const IconThemeData(color: GachiColors.gold),
        cardTheme: const CardThemeData(
          color: GachiOpeningColors.panel,
          margin: EdgeInsets.symmetric(vertical: GachiSpace.sm),
          shape: RoundedRectangleBorder(
            borderRadius: GachiShape.card,
            side: BorderSide(color: GachiOpeningColors.border),
          ),
        ),
        dividerTheme: const DividerThemeData(color: GachiOpeningColors.border),
      ),
      child: child,
    );
  }
}

class GachiOpeningHeading extends StatelessWidget {
  final String title, description;
  const GachiOpeningHeading({
    super.key,
    required this.title,
    required this.description,
  });
  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: GachiSpace.lg),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'GACHI GACHA',
          style: GachiType.english.copyWith(color: GachiColors.gold),
        ),
        const SizedBox(height: GachiSpace.sm),
        Semantics(
          header: true,
          child: Text(
            title,
            style: GachiType.pageTitle.copyWith(color: GachiColors.ivory),
          ),
        ),
        const SizedBox(height: GachiSpace.sm),
        Text(
          description,
          style: GachiType.body.copyWith(color: GachiOpeningColors.secondary),
        ),
      ],
    ),
  );
}

/// Owns visual time only. No repository, request, result selection or routing.
/// Pending data never reveals a product. Skip waits for confirmed input.
class GachiOpeningExperience extends StatefulWidget {
  final bool waiting;
  final Widget result;
  const GachiOpeningExperience({
    super.key,
    required this.waiting,
    required this.result,
  });
  @override
  State<GachiOpeningExperience> createState() => _GachiOpeningExperienceState();
}

class _GachiOpeningExperienceState extends State<GachiOpeningExperience>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _motion = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  );
  bool _skip = false, _reduced = false, _background = false;
  final _resultFocus = FocusNode(debugLabel: 'Confirmed opening result');

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _motion.addStatusListener(_finished);
  }

  void _finished(AnimationStatus status) {
    if (status == AnimationStatus.completed && !widget.waiting && mounted) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !widget.waiting && !_background) {
          _resultFocus.requestFocus();
        }
      });
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _reduced =
        MediaQuery.disableAnimationsOf(context) ||
        MediaQuery.accessibleNavigationOf(context);
    _animate();
  }

  @override
  void didUpdateWidget(covariant GachiOpeningExperience oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.waiting && !widget.waiting) _motion.value = 0;
    if (!oldWidget.waiting && widget.waiting) {
      _skip = false;
      _motion.value = 0;
    }
    _animate();
  }

  void _animate() {
    if (_skip || _reduced) {
      _motion.value = 1;
    } else if (!_background && !_motion.isAnimating && _motion.value < 1) {
      _motion.forward();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _background = state != AppLifecycleState.resumed;
    if (_background) {
      _motion.stop();
    } else {
      _animate();
    }
  }

  void _skipMotion() {
    if (_skip) return;
    setState(() => _skip = true);
    _motion.value = 1;
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _motion.dispose();
    _resultFocus.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: _motion,
    builder: (context, _) {
      if (!widget.waiting && _motion.isCompleted) {
        return Focus(
          focusNode: _resultFocus,
          child: Semantics(liveRegion: true, child: widget.result),
        );
      }
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(GachiSpace.lg),
        decoration: BoxDecoration(
          color: GachiOpeningColors.panel,
          borderRadius: GachiShape.card,
          border: Border.all(color: GachiOpeningColors.border),
        ),
        child: Column(
          children: [
            ExcludeSemantics(
              child: Opacity(
                opacity: .6 + _motion.value * .4,
                child: const Icon(
                  Icons.inventory_2_outlined,
                  size: 64,
                  color: GachiColors.gold,
                ),
              ),
            ),
            const SizedBox(height: GachiSpace.md),
            Semantics(
              liveRegion: true,
              child: Text(
                widget.waiting ? '결과를 확인하고 있어요' : '확정된 상품을 만나보세요',
                textAlign: TextAlign.center,
                style: GachiType.section.copyWith(color: GachiColors.ivory),
              ),
            ),
            const SizedBox(height: GachiSpace.sm),
            Text(
              widget.waiting ? '확인된 결과만 공개합니다.' : '서버에서 확인된 결과입니다.',
              textAlign: TextAlign.center,
              style: GachiType.meta.copyWith(
                color: GachiOpeningColors.secondary,
              ),
            ),
            const SizedBox(height: GachiSpace.sm),
            TextButton(
              onPressed: _skip ? null : _skipMotion,
              child: Text(_skip ? '연출 생략 · 결과 확인 중' : '연출 건너뛰기'),
            ),
          ],
        ),
      );
    },
  );
}

class GachiOpeningBreakdown extends StatelessWidget {
  final int completed, pending, unopened;
  const GachiOpeningBreakdown({
    super.key,
    required this.completed,
    required this.pending,
    required this.unopened,
  });
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Wrap(
      spacing: GachiSpace.sm,
      runSpacing: GachiSpace.sm,
      children: [
        _status('개봉 완료', completed),
        _status('처리 결과 확인 중', pending),
        _status('아직 미개봉', unopened),
      ],
    ),
  );
  Widget _status(String label, int count) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
    decoration: BoxDecoration(
      color: GachiOpeningColors.panel,
      borderRadius: GachiShape.small,
      border: Border.all(color: GachiOpeningColors.border),
    ),
    child: Text(
      '$label $count개',
      style: GachiType.meta.copyWith(color: GachiColors.ivory),
    ),
  );
}

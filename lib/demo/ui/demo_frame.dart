import 'package:flutter/material.dart';

import '../../core/utils/format.dart';
import '../data/demo_storage.dart';
import '../demo_config.dart';

/// 체험판 표시: 늘 보이는 "체험판" 배지와 처음 열 때 한 번 뜨는 안내.
///
/// MaterialApp.builder 안(내비게이터 바깥)에 있어서 어느 화면에서든 같은
/// 자리에 보인다. 테마가 바뀌어도(로그인 전 페이퍼/로그인 후 볼트) 같은
/// 모양이 되도록 색을 직접 정한다.
class DemoFrame extends StatefulWidget {
  final Widget child;
  const DemoFrame({super.key, required this.child});

  static const String noticeSeenKey = 'gachigacha_demo_notice_seen';

  @override
  State<DemoFrame> createState() => _DemoFrameState();
}

class _DemoFrameState extends State<DemoFrame> {
  /// 읽기 전에는 null(안내를 띄우지 않는다).
  bool? _noticeSeen;

  @override
  void initState() {
    super.initState();
    PrefsDemoStorage.instance.read(DemoFrame.noticeSeenKey).then((v) {
      if (mounted) setState(() => _noticeSeen = v == '1');
    });
  }

  void _dismiss() {
    setState(() => _noticeSeen = true);
    PrefsDemoStorage.instance.write(DemoFrame.noticeSeenKey, '1');
  }

  @override
  Widget build(BuildContext context) {
    final top = MediaQuery.paddingOf(context).top;
    return Stack(
      children: [
        Positioned.fill(child: widget.child),
        if (_noticeSeen == false)
          Positioned.fill(child: _DemoNotice(onStart: _dismiss)),
        // 왼쪽 위 모서리. 앱바의 뒤로 가기·제목(위에서 16px 아래부터)과
        // 오른쪽의 GP·닫기 버튼에 겹치지 않는다.
        Positioned(
          top: top + 2,
          left: 6,
          child: const IgnorePointer(child: DemoBadge()),
        ),
      ],
    );
  }
}

const _ink = Color(0xFF16130B);
const _amber = Color(0xFFFFC53D);
const _font = 'Pretendard';

/// 작은 "체험판" 배지.
class DemoBadge extends StatelessWidget {
  const DemoBadge({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '체험판',
      container: true,
      child: Container(
        height: 14,
        padding: const EdgeInsets.symmetric(horizontal: 5),
        decoration: BoxDecoration(
          color: _amber,
          borderRadius: BorderRadius.circular(8),
          boxShadow: const [
            BoxShadow(
              color: Color(0x55000000),
              blurRadius: 4,
              offset: Offset(0, 1),
            ),
          ],
        ),
        alignment: Alignment.center,
        child: const Text(
          '체험판',
          textDirection: TextDirection.ltr,
          style: TextStyle(
            fontFamily: _font,
            fontSize: 9.5,
            height: 1,
            fontWeight: FontWeight.w800,
            color: _ink,
            letterSpacing: -0.2,
            decoration: TextDecoration.none,
          ),
        ),
      ),
    );
  }
}

/// 처음 열 때 안내. 버튼을 누르면 다시 뜨지 않는다.
class _DemoNotice extends StatelessWidget {
  final VoidCallback onStart;
  const _DemoNotice({required this.onStart});

  @override
  Widget build(BuildContext context) {
    const body = TextStyle(
      fontFamily: _font,
      fontSize: 15,
      height: 1.55,
      color: Color(0xFF3A3A3A),
      fontWeight: FontWeight.w500,
    );
    Widget fact(IconData icon, String label, String value) => Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: _ink),
          const SizedBox(width: 8),
          SizedBox(
            width: 64,
            child: Text(
              label,
              style: body.copyWith(fontWeight: FontWeight.w700, color: _ink),
            ),
          ),
          Expanded(child: Text(keepAll(value), style: body)),
        ],
      ),
    );

    return Material(
      color: const Color(0xB3000000),
      child: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Container(
              constraints: const BoxConstraints(maxWidth: 400),
              padding: const EdgeInsets.fromLTRB(22, 22, 22, 18),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 8,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: _amber,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: const Text(
                          '체험판',
                          style: TextStyle(
                            fontFamily: _font,
                            fontSize: 12,
                            fontWeight: FontWeight.w800,
                            color: _ink,
                          ),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    '가치가차 체험판에 오신 걸 환영해요',
                    style: TextStyle(
                      fontFamily: _font,
                      fontSize: 20,
                      height: 1.35,
                      fontWeight: FontWeight.w800,
                      color: _ink,
                      letterSpacing: -0.4,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Text(keepAll(DemoConfig.noticeText), style: body),
                  const SizedBox(height: 6),
                  fact(Icons.percent, '확률·상품', '실제 서비스와 같은 구성·확률·천장'),
                  fact(
                    Icons.toll_outlined,
                    '체험 GP',
                    '200,000 GP로 시작 · 진짜 돈이 아니에요',
                  ),
                  fact(
                    Icons.do_not_disturb_on_outlined,
                    '결제·배송',
                    '실제로 결제·발송되지 않아요',
                  ),
                  fact(Icons.phone_android_outlined, '기록', '이 기기 브라우저에만 저장돼요'),
                  const SizedBox(height: 20),
                  SizedBox(
                    height: 52,
                    child: FilledButton(
                      onPressed: onStart,
                      style: FilledButton.styleFrom(
                        backgroundColor: _ink,
                        foregroundColor: Colors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14),
                        ),
                        textStyle: const TextStyle(
                          fontFamily: _font,
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      child: const Text('체험 시작하기'),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

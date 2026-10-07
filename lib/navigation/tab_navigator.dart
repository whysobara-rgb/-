import 'package:flutter/widgets.dart';

/// 하단 탭.
enum AppTab {
  home('홈'),
  ranking('랭킹'),
  inventory('보관함'),
  wallet('충전'),
  my('MY');

  const AppTab(this.label);
  final String label;
}

/// 하단 탭 전환을 어디서든 할 수 있게 하는 컨트롤러.
///
/// 상세·결과 화면처럼 탭 위에 push된 화면에서 "보관함 보기", "충전하기"를
/// 누르면 루트까지 pop한 뒤 해당 탭으로 전환한다.
class TabNavigator extends ChangeNotifier {
  AppTab _current = AppTab.home;

  /// 탭이 다시 보일 때 목록을 새로 고치도록 탭별 리비전을 둔다.
  final Map<AppTab, int> _revisions = {for (final t in AppTab.values) t: 0};

  AppTab get current => _current;
  int revisionOf(AppTab tab) => _revisions[tab] ?? 0;

  void select(AppTab tab) {
    _revisions[tab] = (_revisions[tab] ?? 0) + 1;
    if (_current == tab) {
      notifyListeners();
      return;
    }
    _current = tab;
    notifyListeners();
  }

  /// push된 화면을 모두 닫고 [tab]으로 이동.
  void goTo(BuildContext context, AppTab tab) {
    Navigator.of(context).popUntil((route) => route.isFirst);
    select(tab);
  }

  bool _topupRequested = false;

  /// 충전 탭으로 가서 충전 시트를 연다(배너 TOPUP 링크). 충전 로직은
  /// 충전 탭의 기존 흐름을 그대로 쓴다.
  void openTopup(BuildContext context) {
    _topupRequested = true;
    goTo(context, AppTab.wallet);
  }

  /// 충전 탭이 한 번만 소비한다.
  bool consumeTopupRequest() {
    final requested = _topupRequested;
    _topupRequested = false;
    return requested;
  }
}

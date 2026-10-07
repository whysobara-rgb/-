import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 뽑기 연출 효과음.
///
/// 소리는 전부 `tool/sfx/generate_sfx.py`가 numpy로 합성한 WAV
/// (assets/sfx/)다. 외부에서 받은 오디오는 쓰지 않는다.
enum Sfx {
  summon('summon'),
  charge('charge'),
  tick('tick'),
  step1('step1'),
  step2('step2'),
  step3('step3'),
  impact('impact'),
  stamp('stamp'),
  srSting('sr_sting'),
  fanfare('fanfare'),
  pop('pop'),
  flip('flip');

  const Sfx(this.file);
  final String file;

  String get assetPath => 'sfx/$file.wav';

  /// 연달아 겹쳐 울릴 수 있는 소리(모두 뒤집기)는 플레이어를 여러 개 둔다.
  int get voices => switch (this) {
    Sfx.pop || Sfx.flip || Sfx.tick => 3,
    _ => 1,
  };
}

/// 효과음 재생기(싱글턴).
///
/// - 음소거는 [muted]로 바꾸고 기기에 저장한다(연출 화면의 스피커 버튼).
/// - 웹은 브라우저 자동재생 규칙 때문에 사용자의 첫 터치([markUserGesture])
///   전에는 아무 소리도 내지 않는다. 뽑기는 언제나 버튼 탭으로 시작하므로
///   실제로는 연출 첫 소리부터 들린다.
/// - 플러그인이 없는 환경(테스트)에서는 조용히 아무것도 하지 않는다.
class SfxPlayer {
  SfxPlayer._();
  static final SfxPlayer instance = SfxPlayer._();

  static const _prefsKey = 'sfx_muted';

  /// true면 소리를 내지 않는다.
  final ValueNotifier<bool> muted = ValueNotifier(false);

  bool _gestured = !kIsWeb;
  bool _loadedPrefs = false;
  bool _disabled = false;
  final Map<Sfx, List<AudioPlayer>> _players = {};
  final Map<Sfx, int> _cursor = {};

  /// 앱 루트의 첫 포인터 입력에서 호출한다(웹 자동재생 잠금 해제).
  void markUserGesture() => _gestured = true;

  Future<void> loadPreference() async {
    if (_loadedPrefs) return;
    _loadedPrefs = true;
    try {
      final prefs = await SharedPreferences.getInstance();
      muted.value = prefs.getBool(_prefsKey) ?? false;
    } catch (_) {}
  }

  Future<void> setMuted(bool value) async {
    muted.value = value;
    if (value) stopAll();
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setBool(_prefsKey, value);
    } catch (_) {}
  }

  /// 연출 화면 진입 시 미리 소스를 올려 첫 재생 지연을 줄인다.
  Future<void> warmUp() async {
    await loadPreference();
    if (_disabled) return;
    for (final s in Sfx.values) {
      for (final p in _ensure(s)) {
        try {
          await p.setSource(AssetSource(s.assetPath));
        } catch (_) {
          // 미리 올리기에 실패해도 재생 시 다시 시도한다.
        }
      }
    }
  }

  List<AudioPlayer> _ensure(Sfx s) {
    return _players.putIfAbsent(s, () {
      final list = <AudioPlayer>[];
      for (var i = 0; i < s.voices; i++) {
        try {
          final p = AudioPlayer(playerId: 'sfx_${s.file}_$i');
          unawaited(_safe(p.setReleaseMode(ReleaseMode.stop)));
          if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
            unawaited(_safe(p.setPlayerMode(PlayerMode.lowLatency)));
          }
          list.add(p);
        } catch (_) {
          _disabled = true;
        }
      }
      return list;
    });
  }

  void play(Sfx s, {double volume = 1}) {
    if (muted.value || !_gestured || _disabled) return;
    final list = _ensure(s);
    if (list.isEmpty) return;
    final i = (_cursor[s] ?? 0) % list.length;
    _cursor[s] = i + 1;
    final p = list[i];
    unawaited(
      _safe(() async {
        if (p.source == null) {
          await p.play(AssetSource(s.assetPath), volume: volume);
          return;
        }
        await p.setVolume(volume);
        await p.seek(Duration.zero);
        await p.resume();
      }()),
    );
  }

  void stop(Sfx s) {
    for (final p in _players[s] ?? const <AudioPlayer>[]) {
      unawaited(_safe(p.stop()));
    }
  }

  void stopAll() {
    for (final s in _players.keys) {
      stop(s);
    }
  }

  static Future<void> _safe(Future<void> f) async {
    try {
      await f;
    } catch (_) {
      // 플러그인 없음·자동재생 거부 등: 소리만 생략한다.
    }
  }
}

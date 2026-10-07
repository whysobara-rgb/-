import 'dart:async';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show rootBundle;
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

  /// 웹은 플레이어마다 AudioContext가 생기므로(사파리는 개수 제한이 있다)
  /// 작은 공용 풀을 돌려 쓴다. 앱은 소리마다 미리 올린 전용 플레이어.
  static const int _webPoolSize = 4;

  /// true면 소리를 내지 않는다.
  final ValueNotifier<bool> muted = ValueNotifier(false);

  bool _gestured = !kIsWeb;
  bool _loadedPrefs = false;
  bool _warmed = false;
  bool _disabled = false;

  /// 앱: 소리별 전용 플레이어.
  final Map<Sfx, List<AudioPlayer>> _dedicated = {};
  final Map<Sfx, int> _cursor = {};

  /// 웹: 공용 풀.
  final List<AudioPlayer> _pool = [];
  int _poolCursor = 0;

  /// 소리별로 마지막에 맡은 플레이어(멈출 때 쓴다).
  final Map<Sfx, AudioPlayer> _last = {};

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

  /// 연출 화면 진입 시 미리 준비해 첫 재생 지연을 줄인다.
  /// 웹은 파일을 미리 받아 브라우저 캐시에 올리고, 앱은 소스를 올려 둔다.
  Future<void> warmUp() async {
    await loadPreference();
    if (_disabled || _warmed) return;
    _warmed = true;
    if (kIsWeb) {
      for (final s in Sfx.values) {
        try {
          await rootBundle.load('assets/${s.assetPath}');
        } catch (_) {}
      }
      return;
    }
    for (final s in Sfx.values) {
      for (final p in _dedicatedFor(s)) {
        try {
          await p.setSource(AssetSource(s.assetPath));
        } catch (_) {
          // 미리 올리기에 실패해도 재생 시 다시 시도한다.
        }
      }
    }
  }

  AudioPlayer? _create(String id) {
    try {
      final p = AudioPlayer(playerId: id);
      unawaited(_safe(p.setReleaseMode(ReleaseMode.stop)));
      if (!kIsWeb && defaultTargetPlatform == TargetPlatform.android) {
        unawaited(_safe(p.setPlayerMode(PlayerMode.lowLatency)));
      }
      return p;
    } catch (_) {
      _disabled = true;
      return null;
    }
  }

  List<AudioPlayer> _dedicatedFor(Sfx s) => _dedicated.putIfAbsent(s, () {
    return [for (var i = 0; i < s.voices; i++) ?_create('sfx_${s.file}_$i')];
  });

  AudioPlayer? _pick(Sfx s) {
    if (!kIsWeb) {
      final list = _dedicatedFor(s);
      if (list.isEmpty) return null;
      final i = (_cursor[s] ?? 0) % list.length;
      _cursor[s] = i + 1;
      return list[i];
    }
    while (_pool.length < _webPoolSize) {
      final p = _create('sfx_pool_${_pool.length}');
      if (p == null) return null;
      _pool.add(p);
    }
    // 길게 울리는 차지 소리를 맡은 플레이어는 가능하면 건너뛴다.
    final charging = _last[Sfx.charge];
    for (var k = 0; k < _pool.length; k++) {
      final p = _pool[_poolCursor++ % _pool.length];
      if (!identical(p, charging) || s == Sfx.charge) return p;
    }
    return _pool.first;
  }

  void play(Sfx s, {double volume = 1}) {
    if (muted.value || !_gestured || _disabled) return;
    final p = _pick(s);
    if (p == null) return;
    _last[s] = p;
    unawaited(
      _safe(() async {
        if (kIsWeb || p.source == null) {
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
    final last = _last.remove(s);
    if (kIsWeb) {
      if (last != null) unawaited(_safe(last.stop()));
      return;
    }
    for (final p in _dedicated[s] ?? const <AudioPlayer>[]) {
      unawaited(_safe(p.stop()));
    }
  }

  void stopAll() {
    for (final p in [..._pool, for (final l in _dedicated.values) ...l]) {
      unawaited(_safe(p.stop()));
    }
    _last.clear();
  }

  static Future<void> _safe(Future<void> f) async {
    try {
      await f;
    } catch (_) {
      // 플러그인 없음·자동재생 거부 등: 소리만 생략한다.
    }
  }
}

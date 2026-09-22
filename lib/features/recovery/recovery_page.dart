import '../../shared/widgets/gachi_flow.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import '../account_security/account_security_repository.dart';
import 'recovery_repository.dart';

class RecoveryPage extends StatefulWidget {
  final bool verifyEmail;
  final RecoveryRepository repository;
  const RecoveryPage({super.key, this.verifyEmail = false,
    this.repository = const RecoveryRepository()});
  @override
  State<RecoveryPage> createState() => _RecoveryPageState();
}

class _RecoveryPageState extends State<RecoveryPage> with WidgetsBindingObserver {
  final _email = TextEditingController(), _link = TextEditingController();
  final _next = TextEditingController(), _repeat = TextEditingController();
  late final AuthProvider _auth;
  late final int _session;
  late final String _expectedEmail;
  RecoveryCapabilities? _caps;
  EmailVerificationStatus? _emailStatus;
  bool _loading = true, _busy = false, _confirming = false;
  bool _ended = false, _disposed = false, _resetCompleted = false;
  int _loadVersion = 0, _life = 0, _cooldown = 0;
  Timer? _timer;
  String? _message;

  bool get _current => !_disposed && mounted && !_ended &&
      _auth.sessionGeneration == _session &&
      (widget.verifyEmail ? _auth.isSessionCurrent(_session)
        : !_auth.isLoggedIn && !_auth.isLoading && !_auth.isInitializing);
  bool get _locked => _busy || _confirming;

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthProvider>();
    _session = _auth.sessionGeneration;
    _expectedEmail = _auth.currentUser?.email ?? '';
    _auth.addListener(_authChanged);
    WidgetsBinding.instance.addObserver(this);
    Future<void>.microtask(_load);
  }

  void _clearSecrets() { _link.clear(); _next.clear(); _repeat.clear(); }

  void _authChanged() {
    if (_disposed || !mounted || _current) { return; }
    _clearSecrets(); _email.clear(); _timer?.cancel(); _loadVersion++;
    setState(() {
      _ended = true; _loading = false; _caps = null; _emailStatus = null;
      _message = '로그인 상태가 바뀌었습니다. 이 화면을 닫고 다시 열어주세요.';
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) { _life++; _clearSecrets(); }
  }

  Future<void> _load() async {
    if (!_current) { _authChanged(); return; }
    final v = ++_loadVersion;
    setState(() { _loading = true; _caps = null; _emailStatus = null; _message = null; });
    try {
      final caps = await widget.repository.capabilities(() => _current);
      final status = widget.verifyEmail
          ? await widget.repository.emailStatus(_expectedEmail, () => _current) : null;
      if (_current && v == _loadVersion) {
        setState(() { _caps = caps; _emailStatus = status; });
      }
    } catch (e) {
      if (_current && v == _loadVersion) {
        setState(() { _message = _error(e, changing: false); });
      }
    } finally {
      if (_current && v == _loadVersion) { setState(() { _loading = false; }); }
    }
  }

  String _error(Object e, {required bool changing}) {
    final status = e is ApiException ? e.httpStatusCode : null;
    if (status == 401) { return '로그인이 만료됐습니다. 다시 로그인해주세요.'; }
    if (status == 404 || status == 503) { return '현재 서버에서 계정 복구 기능을 준비하고 있습니다.'; }
    if (status == 429) { return '요청이 잠시 제한됐습니다. 기다린 뒤 다시 시도해주세요.'; }
    if (status == 400 || status == 409) {
      return '입력 내용 또는 링크를 확인해주세요. 만료되거나 사용된 링크는 새로 요청해야 합니다.';
    }
    return changing
        ? '서버 처리 결과를 확인하지 못했습니다. 자동 재시도하지 않았습니다. 재설정 요청이었다면 새 비밀번호로 로그인을 확인하고, 이메일 인증은 상태를 다시 조회해주세요.'
        : '상태를 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해주세요.';
  }

  void _startCooldown() {
    _timer?.cancel(); _cooldown = 60;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      if (!_current || _cooldown <= 1) {
        timer.cancel();
        if (_current) { setState(() { _cooldown = 0; }); }
      } else { setState(() { _cooldown--; }); }
    });
  }

  Future<void> _requestMail() async {
    if (!_current || _locked || _cooldown > 0 || _caps?.enabled != true) { return; }
    if (!widget.verifyEmail && recoveryEmailError(_email.text) != null) {
      setState(() { _message = recoveryEmailError(_email.text); }); return;
    }
    setState(() { _busy = true; _message = null; });
    // Cooldown is a UI courtesy, not a replacement for server rate limiting.
    _startCooldown();
    try {
      if (widget.verifyEmail) { await widget.repository.requestVerification(() => _current); }
      else { await widget.repository.requestReset(_email.text, () => _current); }
      if (_current) { setState(() { _message = recoveryAcceptedMessage; }); }
    } catch (e) {
      if (_current) { setState(() { _message = _error(e, changing: true); }); }
    } finally {
      if (!_disposed && mounted) { setState(() { _busy = false; }); }
    }
  }

  Future<void> _complete() async {
    if (!_current || _locked || _caps?.enabled != true || _resetCompleted) { return; }
    try {
      widget.repository.tokenFromLink(_link.text,
          widget.verifyEmail ? RecoveryPurpose.verify : RecoveryPurpose.reset);
    } catch (_) {
      setState(() { _message = '이 앱에 설정된 서비스에서 받은 올바른 인증 링크를 붙여넣어주세요.'; }); return;
    }
    if (!widget.verifyEmail) {
      final error = newPasswordError(_next.text);
      if (error != null || _next.text != _repeat.text) {
        setState(() { _message = error ?? '새 비밀번호가 일치하지 않습니다'; }); return;
      }
    }
    final life = _life;
    setState(() { _confirming = true; _message = null; });
    try {
      final confirmed = await showDialog<bool>(context: context, builder: (d) => GachiFlowDialog(
        scrollable: true,
        title: Text(widget.verifyEmail ? '이메일 링크를 확인할까요?' : '비밀번호를 재설정할까요?'),
        content: Text(widget.verifyEmail
          ? '이 링크가 발급된 이메일 주소를 인증합니다. 현재 로그인 계정과 같은 주소의 메일인지 확인해주세요. 본인·연령 인증을 대신하지 않습니다.'
          : '링크가 발급된 계정의 비밀번호가 변경되고 기존 로그인은 해제됩니다. 본인이 요청한 메일인지 확인해주세요.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(d, false), child: const Text('취소')),
          FilledButton(key: const Key('recovery-confirm'),
            onPressed: () => Navigator.pop(d, true), child: const Text('확인 후 실행')),
        ],
      ));
      if (confirmed != true || !_current || life != _life) { return; }
      final link = _link.text, next = _next.text;
      _clearSecrets(); FocusManager.instance.primaryFocus?.unfocus();
      setState(() { _busy = true; });
      if (widget.verifyEmail) {
        await widget.repository.completeVerification(link, () => _current && life == _life);
        if (!_current) { return; }
        final status = await widget.repository.emailStatus(_expectedEmail, () => _current);
        if (_current) {
          setState(() {
            _emailStatus = status;
            _message = status.verified ? '현재 계정의 이메일 인증을 확인했습니다.'
              : '링크는 처리됐지만 현재 계정의 이메일은 미인증입니다. 같은 주소의 메일인지 확인해주세요.';
          });
        }
      } else {
        await widget.repository.completeReset(link, next, () => _current && life == _life);
        if (_current) {
          setState(() { _resetCompleted = true; _message = '비밀번호가 재설정됐습니다. 새 비밀번호로 다시 로그인해주세요.'; });
        }
      }
    } catch (e) {
      if (_current) { setState(() { _message = _error(e, changing: true); }); }
    } finally {
      if (!_disposed && mounted) { setState(() { _busy = false; _confirming = false; }); }
    }
  }

  Widget _field(String label, String key, TextEditingController controller,
      {bool secret = true, int max = 64}) => Padding(
    padding: const EdgeInsets.only(bottom: 16),
    child: TextField(key: Key(key), controller: controller, enabled: !_locked,
      obscureText: secret, autocorrect: false, enableSuggestions: false,
      enableIMEPersonalizedLearning: false, maxLength: max,
      keyboardType: secret ? TextInputType.visiblePassword : TextInputType.emailAddress,
      decoration: InputDecoration(labelText: label)),
  );

  @override
  Widget build(BuildContext context) => PopScope(canPop: !_locked,
    child: GachiFlowScaffold(appBar: AppBar(title: Text(widget.verifyEmail ? '이메일 인증' : '비밀번호 찾기')),
      body: SingleChildScrollView(padding: const EdgeInsets.all(GachiSpace.page),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          GachiFlowHeading(label: widget.verifyEmail ? 'EMAIL VERIFICATION' : 'ACCOUNT RECOVERY',
            title: widget.verifyEmail ? '이메일 소유 확인' : '계정으로 돌아가기',
            description: '이메일 소유 확인은 본인·연령 인증과 다릅니다.'),
          if (_message != null) Semantics(liveRegion: true,
            child: Padding(padding: const EdgeInsets.only(bottom: 20),
              child: Text(_message!, key: const Key('recovery-message')))),
          if (_ended || _resetCompleted)
            FilledButton(onPressed: () => Navigator.of(context).pop(), child: const Text('이전 화면으로'))
          else if (_loading) const Center(child: CircularProgressIndicator(semanticsLabel: '계정 복구 상태 조회 중'))
          else ...[
            if (_emailStatus != null) ...[
              Text(_emailStatus!.email),
              Text(_emailStatus!.verified ? '이메일 인증 완료' : '이메일 미인증', key: const Key('email-status')),
              const SizedBox(height: 16),
            ],
            if (_caps?.enabled != true) ...[
              const Text('이메일 인증·복구 서비스 연결을 준비하고 있습니다.'),
              OutlinedButton(onPressed: _locked ? null : _load, child: const Text('상태 다시 조회')),
            ] else if (_emailStatus?.verified == true)
              OutlinedButton(onPressed: _locked ? null : _load, child: const Text('상태 다시 조회'))
            else ...[
              if (!widget.verifyEmail) _field('가입한 이메일', 'recovery-email', _email, secret: false, max: 255),
              FilledButton(key: const Key('recovery-request'),
                                onPressed: _locked || _cooldown > 0 ? null : _requestMail,
                child: Text(_cooldown > 0 ? '다시 요청 가능: $_cooldown초' : '안내 메일 요청')),
              const SizedBox(height: 12),
              const Text('메일 요청을 접수해도 실제 발송·도착을 보장하지 않습니다. 가입 여부와 무관하게 같은 안내가 표시됩니다.'),
              const SizedBox(height: 24),
              if (widget.repository.trustedOrigin == null)
                const Text('이 앱에는 인증 링크의 서비스 주소 설정이 아직 없습니다. 메일 링크를 앱에 붙여넣는 기능은 비활성 상태입니다.')
              else ...[
                Text('메일에서 받은 링크를 직접 붙여넣으세요. 링크 유효시간: ${widget.verifyEmail ? _caps!.verificationMinutes : _caps!.resetMinutes}분. 만료와 사용 여부는 서버가 확인합니다.'),
                const SizedBox(height: 12),
                _field('메일의 인증 링크', 'recovery-link', _link, max: 2048),
                if (!widget.verifyEmail) ...[
                  _field('새 비밀번호', 'recovery-next', _next),
                  _field('새 비밀번호 확인', 'recovery-repeat', _repeat),
                ],
                OutlinedButton(key: const Key('recovery-complete'),
                                    onPressed: _locked ? null : _complete,
                  child: Text(widget.verifyEmail ? '인증 링크 확인' : '새 비밀번호로 재설정')),
                if (widget.verifyEmail) TextButton(onPressed: _locked ? null : _load,
                  child: const Text('상태 다시 조회')),
              ],
            ],
          ],
          if (_busy) const Padding(padding: EdgeInsets.only(top: 16),
            child: Text('서버의 처리 결과를 확인하고 있습니다. 중복 요청하지 마세요.')),
        ])),
    ));

  @override
  void dispose() {
    _disposed = true; _timer?.cancel();
    _auth.removeListener(_authChanged); WidgetsBinding.instance.removeObserver(this);
    _email.dispose(); _link.dispose(); _next.dispose(); _repeat.dispose();
    super.dispose();
  }
}

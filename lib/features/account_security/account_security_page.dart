import '../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import 'account_security_repository.dart';

class AccountSecurityPage extends StatefulWidget {
  final AccountSecurityRepository repository;
  const AccountSecurityPage({
    super.key,
    this.repository = const AccountSecurityRepository(),
  });

  @override
  State<AccountSecurityPage> createState() => _AccountSecurityPageState();
}

class _AccountSecurityPageState extends State<AccountSecurityPage>
    with WidgetsBindingObserver {
  final _form = GlobalKey<FormState>();
  final _currentPassword = TextEditingController();
  final _newPassword = TextEditingController();
  final _confirmation = TextEditingController();
  late final AuthProvider _auth;
  late final int _session;
  AccountSecurityCapabilities? _capabilities;
  bool _loading = true, _busy = false, _ended = false, _disposed = false;
  bool _validateChange = true;
  int _loadGeneration = 0, _lifecycleGeneration = 0;
  String? _message;

  bool get _current => !_disposed && mounted && !_ended &&
      _auth.isSessionCurrent(_session);

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthProvider>();
    _session = _auth.sessionGeneration;
    _auth.addListener(_authChanged);
    WidgetsBinding.instance.addObserver(this);
    Future<void>.microtask(_load);
  }

  void _clearSecrets() {
    _currentPassword.clear();
    _newPassword.clear();
    _confirmation.clear();
  }

  void _authChanged() {
    if (_disposed || !mounted || _auth.isSessionCurrent(_session)) return;
    _clearSecrets();
    _loadGeneration++;
    setState(() {
      _ended = true;
      _loading = false;
      _busy = false;
      _capabilities = null;
      _message = '로그인 상태가 바뀌었습니다. 다시 로그인한 뒤 이용해주세요.';
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) {
      _lifecycleGeneration++;
      _clearSecrets();
    }
  }

  Future<void> _load() async {
    if (!_current) {
      _authChanged();
      return;
    }
    final generation = ++_loadGeneration;
    setState(() { _loading = true; _message = null; _capabilities = null; });
    try {
      final value = await widget.repository.capabilities(() => _current);
      if (!_current || generation != _loadGeneration) return;
      setState(() { _capabilities = value; });
    } catch (error) {
      if (!_current || generation != _loadGeneration) return;
      if (error is ApiException && error.httpStatusCode == 401) {
        await _endSession('로그인이 만료됐습니다. 다시 로그인해주세요.');
      } else {
        setState(() { _message = error is ApiException &&
                error.httpStatusCode == 404
            ? '이 서버에는 계정 보안 기능이 아직 반영되지 않았습니다.'
            : '계정 보안 기능을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 조회해주세요.'; });
      }
    } finally {
      if (_current && generation == _loadGeneration) {
        setState(() { _loading = false; });
      }
    }
  }

  Future<void> _endSession(String message) async {
    final ended = await _auth.logoutIfSession(_session);
    if (_disposed || !mounted || !ended) return;
    setState(() {
      _ended = true;
      _busy = false;
      _loading = false;
      _message = message;
    });
  }

  Future<void> _submit({required bool changePassword}) async {
    if (!_current || _busy || _capabilities?.enabled != true) return;
    _validateChange = changePassword;
    if (_form.currentState?.validate() != true) return;
    final lifecycle = _lifecycleGeneration;
    setState(() { _busy = true; _message = null; });
    try {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (dialog) => GachiFlowDialog(
          scrollable: true,
          title: Text(changePassword ? '비밀번호를 변경할까요?' : '모든 로그인을 해제할까요?'),
          content: Text(changePassword
              ? '변경하면 이 기기를 포함한 기존 로그인이 해제됩니다. 새 비밀번호로 다시 로그인해야 합니다.'
              : '이 기기와 다른 기기의 기존 로그인이 해제됩니다. 비밀번호는 바뀌지 않습니다.'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(dialog, false),
                child: const Text('취소')),
            FilledButton(key: const Key('security-confirm-action'),
                onPressed: () => Navigator.pop(dialog, true),
                child: const Text('확인 후 실행')),
          ],
        ),
      );
      if (confirmed != true || !_current || lifecycle != _lifecycleGeneration) return;
      final current = _currentPassword.text;
      final next = _newPassword.text;
      // Clear controllers before network I/O. Credentials are never journaled,
      // automatically retried, logged, or placed in navigation arguments.
      _clearSecrets();
      FocusManager.instance.primaryFocus?.unfocus();
      try {
        if (changePassword) {
          await widget.repository.changePassword(current, next, () => _current);
        } else {
          await widget.repository.revokeSessions(current, () => _current);
        }
        if (!_current) return;
        await _endSession(changePassword
            ? '비밀번호가 변경됐습니다. 새 비밀번호로 다시 로그인해주세요.'
            : '기존 로그인이 해제됐습니다. 다시 로그인해주세요.');
      } catch (error) {
        if (!_current) return;
        final status = error is ApiException ? error.httpStatusCode : null;
        if (status == 400 || status == 403 || status == 409 || status == 429) {
          setState(() { _message = status == 429
              ? '비밀번호 확인이 잠시 제한됐습니다. 잠시 후 다시 시도해주세요.'
              : status == 409
              ? '이메일 비밀번호 계정인지, 현재 비밀번호와 다른 값을 입력했는지 확인해주세요.'
              : '요청이 거절됐습니다. 현재 비밀번호와 입력 조건을 다시 확인해주세요.'; });
        } else {
          // No receipt-query contract exists for these endpoints. Do not claim
          // failure/success or replay a password operation after response loss.
          await _endSession(status == 401
              ? '로그인이 만료됐습니다. 다시 로그인해주세요.'
              : '서버 처리 결과를 확인하지 못해 이 기기에서 로그아웃했습니다. 자동 재시도하지 않았습니다. 비밀번호 변경을 요청했다면 새 비밀번호로 로그인해 확인해주세요.');
        }
      }
    } finally {
      if (!_disposed && mounted) {
        setState(() { _busy = false; });
      }
    }
  }

  Widget _passwordField(String label, Key key,
      TextEditingController controller, String? Function(String?) validator) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: TextFormField(
        key: key,
        controller: controller,
        enabled: !_busy,
        obscureText: true,
        autocorrect: false,
        enableSuggestions: false,
        enableIMEPersonalizedLearning: false,
        keyboardType: TextInputType.visiblePassword,
        maxLength: 64,
        decoration: InputDecoration(labelText: label, errorMaxLines: 4),
        validator: validator,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: !_busy,
      child: GachiFlowScaffold(
        appBar: AppBar(title: const Text('계정 보안')),
        body: GachiFlowList(
          padding: const EdgeInsets.all(GachiSpace.page),
          children: [
            const GachiFlowHeading(label: 'ACCOUNT SECURITY', title: '비밀번호 · 로그인 관리',
              description: '앱 계정의 비밀번호를 바꾸거나 다른 기기의 로그인을 해제합니다. 관리자 인증앱 설정과는 별개입니다.'),
            if (_message != null)
              Semantics(liveRegion: true,
                child: Padding(padding: const EdgeInsets.only(bottom: 20),
                    child: Text(_message!, key: const Key('security-message')))),
            if (_ended) ...[
              if (_auth.errorMessage != null)
                const Text('기기의 로그인 정보 삭제에 실패했습니다. 로그인 화면에서 로그아웃 상태를 다시 확인해주세요.'),
              FilledButton(onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst),
                  child: const Text('로그인 화면으로')),
            ] else if (_loading)
              const Center(child: CircularProgressIndicator(semanticsLabel: '계정 보안 기능 조회 중'))
            else if (_capabilities?.enabled != true) ...[
              if (_capabilities != null) const Text('계정 보안 기능을 준비하고 있습니다.'),
              const SizedBox(height: 12),
              OutlinedButton(onPressed: _load, child: const Text('다시 조회')),
            ] else
              Form(key: _form, child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _passwordField('현재 비밀번호', const Key('security-current'),
                      _currentPassword, (v) => currentPasswordError(v ?? '')),
                  const Text('새 비밀번호는 영문·숫자 포함 8~64자, UTF-8 72바이트 이내여야 합니다.'),
                  const SizedBox(height: 16),
                  _passwordField('새 비밀번호', const Key('security-next'),
                      _newPassword, (v) => !_validateChange ? null :
                          (v == _currentPassword.text ? '현재와 다른 비밀번호를 입력해주세요' : newPasswordError(v ?? ''))),
                  _passwordField('새 비밀번호 확인', const Key('security-repeat'),
                      _confirmation, (v) => !_validateChange ? null :
                          (v == _newPassword.text ? null : '새 비밀번호가 일치하지 않습니다')),
                  FilledButton(key: const Key('security-change'),
                                            onPressed: _busy ? null : () => _submit(changePassword: true),
                      child: const Text('비밀번호 변경')),
                  const SizedBox(height: 24),
                  const Text('다른 기기의 접근이 걱정되나요? 현재 비밀번호를 입력한 뒤 모든 로그인을 해제할 수 있습니다.'),
                  const SizedBox(height: 12),
                  OutlinedButton(key: const Key('security-revoke'),
                                            onPressed: _busy ? null : () => _submit(changePassword: false),
                      child: const Text('모든 로그인 해제')),
                  if (_busy) const Padding(padding: EdgeInsets.only(top: 16),
                      child: Text('처리 중에는 중복 요청하지 마세요. 응답을 기다리고 있습니다.')),
                ],
              )),
          ],
        ),
      ),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    WidgetsBinding.instance.removeObserver(this);
    _auth.removeListener(_authChanged);
    _currentPassword.dispose();
    _newPassword.dispose();
    _confirmation.dispose();
    super.dispose();
  }
}

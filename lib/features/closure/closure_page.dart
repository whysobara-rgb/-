import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/config/app_config.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import '../account_security/account_security_repository.dart';
import '../customer_updates/customer_updates_page.dart';
import '../orders/order_repository.dart';
import 'closure_models.dart';
import 'closure_repository.dart';

class AccountClosurePage extends StatefulWidget {
  final ClosureRepository? repository;
  const AccountClosurePage({super.key, this.repository});
  @override
  State<AccountClosurePage> createState() => _AccountClosurePageState();
}

class _AccountClosurePageState extends State<AccountClosurePage>
    with WidgetsBindingObserver {
  final _form = GlobalKey<FormState>();
  final _password = TextEditingController();
  final _reason = TextEditingController();
  final _confirmation = TextEditingController();
  late final AuthProvider _auth;
  late final int _session;
  late final ClosureRepository _repo;
  ClosureCheck? _check;
  PendingClosure? _pending;
  ClosureReceipt? _receipt;
  bool _loading = true, _busy = false, _working = false;
  bool _ended = false, _disposed = false, _enabled = false;
  int _generation = 0, _lifecycle = 0;
  String? _message;
  bool get _current => mounted && !_disposed && !_ended &&
      _auth.isSessionCurrent(_session);
  bool get _resolved => _receipt != null &&
      (_pending?.kind != 'cancel' || _receipt!.cancelled);

  @override
  void initState() {
    super.initState();
    _auth = context.read<AuthProvider>();
    _session = _auth.sessionGeneration;
    _repo = widget.repository ?? ClosureRepository(api: const ApiClient(),
      store: SecureOrderStore(), userId: _auth.currentUser?.id ?? 0,
      server: AppConfig.apiBaseUrl, sessionIsCurrent: () => _current);
    _auth.addListener(_authChanged);
    WidgetsBinding.instance.addObserver(this);
    Future<void>.microtask(_reload);
  }
  void _clear() {
    _password.clear(); _confirmation.clear(); _reason.clear();
  }
  void _authChanged() {
    if (!mounted || _disposed || _auth.isSessionCurrent(_session)) { return; }
    _clear(); _generation++;
    setState(() {
      _ended = true; _check = null; _pending = null; _receipt = null;
      _loading = false; _busy = false; _working = false;
      _message = '로그인 상태가 바뀌었습니다. 다시 로그인한 뒤 요청을 확인해주세요.';
    });
  }
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed) { _lifecycle++; _clear(); }
  }
  String _error(Object e) {
    final status = e is ApiException ? e.httpStatusCode : null;
    if (status == 401) { return '로그인이 만료됐습니다. 다시 로그인해주세요.'; }
    if (status == 429) { return '비밀번호 확인이 잠시 제한됐습니다. 잠시 후 다시 시도해주세요.'; }
    if (status == 400 || status == 403 || status == 409) {
      return '요청을 확인하지 못했습니다. 비밀번호·진행 중 요청을 확인해주세요. 아래 조회 결과와 보관된 요청을 먼저 확인하세요.';
    }
    if (status == 404) { return '요청 또는 조회 기능을 확인하지 못했습니다. 삭제·취소 완료로 처리하지 않았습니다.'; }
    return '처리 결과를 확인하지 못했습니다. 자동 재전송하지 않았습니다. 같은 계정에서 결과를 다시 조회해주세요.';
  }
  Future<void> _reload({String? message}) async {
    if (!_current) { _authChanged(); return; }
    final generation = ++_generation;
    setState(() {
      _loading = true; _enabled = false;
      _check = null; _pending = null; _receipt = null; _message = message;
    });
    try {
      final enabled = await _repo.capabilities();
      final pending = await _repo.pending();
      final check = await _repo.check();
      final receipt = pending == null ? null : await _repo.recover();
      if (!_current || generation != _generation) { return; }
      setState(() {
        _enabled = enabled; _pending = pending; _check = check; _receipt = receipt;
      });
    } catch (e) {
      if (!_current || generation != _generation) { return; }
      setState(() { _message = _error(e); });
    } finally {
      if (_current && generation == _generation) { setState(() { _loading = false; }); }
    }
  }
  Future<void> _confirmAction(String title, Future<ClosureReceipt> Function() action) async {
    if (!_current || _busy || !_enabled) { return; }
    final lifecycle = _lifecycle;
    setState(() { _busy = true; });
    String? message;
    bool dispatched = false;
    try {
      final agreed = await showDialog<bool>(context: context, builder: (dialog) => AlertDialog(
        scrollable: true, title: Text(title),
        content: const Text('이 작업은 탈퇴 요청 접수 또는 그 요청의 취소입니다. 계정·개인정보 삭제나 GP·상품 소멸을 실행하지 않습니다.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialog, false), child: const Text('돌아가기')),
          FilledButton(key: const Key('closure-confirm-action'),
            onPressed: () => Navigator.pop(dialog, true), child: const Text('확인 후 실행')),
        ],
      ));
      if (agreed != true || !_current || lifecycle != _lifecycle) { return; }
      _clear(); FocusManager.instance.primaryFocus?.unfocus();
      setState(() { _working = true; });
      dispatched = true;
      final r = await action();
      if (!_current) { return; }
      message = r.cancelled
          ? '탈퇴 요청 취소 결과를 받았습니다. 아래 서버 조회 결과를 확인해주세요.'
          : '탈퇴 요청 접수 결과를 받았습니다. 탈퇴 완료나 계정 삭제가 아닙니다.';
    } catch (e) {
      if (_current) { message = _error(e); }
    } finally {
      if (_current) {
        setState(() { _busy = false; _working = false; });
        if (dispatched) { await _reload(message: message); }
      }
    }
  }
  Future<void> _submit() async {
    if (_busy || _form.currentState?.validate() != true) { return; }
    final password = _password.text, reason = _reason.text;
    await _confirmAction(_pending == null ? '탈퇴 요청을 접수할까요?' : '같은 요청을 재개할까요?',
      () => _pending == null ? _repo.request(reason, password) : _repo.retry(password: password));
  }
  Future<void> _acknowledge() async {
    if (!_current || _busy || !_resolved) { return; }
    final receipt = _receipt!;
    setState(() { _busy = true; _working = true; });
    String? message;
    try { await _repo.acknowledge(receipt); }
    catch (e) { message = _error(e); }
    finally {
      if (_current) {
        setState(() { _busy = false; _working = false; });
        await _reload(message: message);
      }
    }
  }
  Widget _inputForm() => Form(key: _form, child: Column(
    crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (_pending == null) TextFormField(
        key: const Key('closure-reason'), controller: _reason, enabled: !_busy,
        maxLength: 255, decoration: const InputDecoration(labelText: '요청 사유', errorMaxLines: 3),
        validator: (v) => v == null || v.trim().isEmpty ||
            RegExp(r'[\x00-\x1f\x7f]').hasMatch(v) ? '사유를 한 줄로 입력해주세요' : null,
      ) else Text('보관된 요청 사유: ${_pending!.reason}'),
      TextFormField(key: const Key('closure-password'), controller: _password,
        enabled: !_busy, obscureText: true, autocorrect: false,
        enableSuggestions: false, enableIMEPersonalizedLearning: false,
        maxLength: 64, decoration: const InputDecoration(labelText: '현재 비밀번호', errorMaxLines: 3),
        validator: (v) => currentPasswordError(v ?? ''),
      ),
      TextFormField(key: const Key('closure-wording'), controller: _confirmation,
        enabled: !_busy, maxLength: 20,
        decoration: const InputDecoration(labelText: '확인 문구: 탈퇴 요청', errorMaxLines: 3),
        validator: (v) => v == '탈퇴 요청' ? null : '탈퇴 요청을 정확히 입력해주세요',
      ),
      const Text('비밀번호는 저장하지 않습니다. 결과가 끊긴 요청을 재개할 때는 다시 입력해야 합니다.'),
      const SizedBox(height: 12),
      FilledButton(key: const Key('closure-submit'),
        onPressed: _busy || !_enabled ? null : _submit,
        child: Text(_pending == null ? '탈퇴 요청 접수' : '같은 요청 재개')),
    ],
  ));

  @override
  Widget build(BuildContext context) => PopScope(canPop: !_busy,
    child: Scaffold(appBar: AppBar(title: const Text('탈퇴 요청·상태')),
      body: SingleChildScrollView(padding: const EdgeInsets.all(20),
        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          const Text('계정을 바로 삭제하지 않습니다',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          const Text('현재 기능은 탈퇴 요청 접수입니다. 잔액·보관 상품·진행 중 거래를 함께 확인하며, 접수만으로 GP나 상품을 소멸시키지 않습니다. 최종 삭제·보존 범위와 처리 일정은 별도 확인이 필요합니다.'),
          const SizedBox(height: 16),
          if (_message != null) Semantics(liveRegion: true,
            child: Text(_message!, key: const Key('closure-message'))),
          if (_ended) FilledButton(onPressed: () => Navigator.of(context).popUntil((r) => r.isFirst),
            child: const Text('로그인 화면으로'))
          else ...[
            if (_loading || _working) const Padding(padding: EdgeInsets.all(16),
              child: Center(child: CircularProgressIndicator(semanticsLabel: '서버 처리 결과 확인 중'))),
            if (!_loading && !_working) ...[
              if (_check != null) ...[
                const SizedBox(height: 16),
                const Text('현재 계정 현황 · 항목 간 중복 수량 포함',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                const Text('현재 조회 값이며 탈퇴 가능 여부나 자동 삭제 판정이 아닙니다.'),
                for (final entry in _check!.summary.values.entries)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Text('${closureSummaryLabels[entry.key]}: ${entry.value}${entry.key == 'balance' ? ' GP' : ''}')),
                const Divider(),
              ],
              if (_resolved) ...[
                Text(_receipt!.cancelled ? '요청 취소 확인' : '요청 접수 확인',
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                Text('요청번호: ${_receipt!.id}'),
                const Text('계정은 삭제되지 않았습니다.'),
                FilledButton(key: const Key('closure-ack'), onPressed: _busy ? null : _acknowledge,
                  child: const Text('결과 확인')),
              ] else if (_pending != null) ...[
                const Text('이전 작업 결과를 먼저 확인해주세요. 새 요청번호로 반복 제출하지 않습니다.'),
                if (_pending!.kind == 'request' && _enabled) _inputForm()
                else if (_enabled) OutlinedButton(key: const Key('closure-retry-cancel'),
                  onPressed: _busy ? null : () => _confirmAction('같은 요청 취소를 재개할까요?', () => _repo.retry()),
                  child: const Text('같은 취소 요청 재개')),
              ] else if (_check?.active != null) ...[
                const Text('진행 중인 탈퇴 요청', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                Text('요청번호: ${_check!.active!.id}'),
                Text('요청 사유: ${_check!.active!.reason}'),
                const Text('요청 접수 상태입니다. 계정 삭제 완료가 아닙니다.'),
                OutlinedButton(key: const Key('closure-cancel'),
                  onPressed: _busy || !_enabled ? null : () {
                    final active = _check!.active!;
                    return _confirmAction('탈퇴 요청을 취소할까요?', () => _repo.cancel(active));
                  }, child: const Text('탈퇴 요청 취소')),
              ] else if (_check != null && _enabled) _inputForm(),
              if (_check != null && !_enabled) const Text('새 요청 기능을 준비하고 있습니다.'),
              const SizedBox(height: 16),
              OutlinedButton(key: const Key('closure-refresh'), onPressed: _busy ? null : _reload,
                child: const Text('상태 다시 조회')),
              TextButton(onPressed: _busy ? null : () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CustomerUpdatesPage(initial: 'tickets'))),
                child: const Text('고객지원에서 문의')),
            ],
          ],
        ]),
      ),
    ),
  );
  @override
  void dispose() {
    _disposed = true; _generation++;
    _auth.removeListener(_authChanged); WidgetsBinding.instance.removeObserver(this);
    _password.dispose(); _reason.dispose(); _confirmation.dispose();
    super.dispose();
  }
}

import '../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import 'conversion_models.dart';
import 'conversion_repository.dart';

class ConversionPage extends StatefulWidget {
  final int userId;
  final List<int>? inventoryIds;
  final ConversionRepository? repository;
  const ConversionPage({
    super.key,
    required this.userId,
    this.inventoryIds,
    this.repository,
  });
  @override
  State<ConversionPage> createState() => _ConversionPageState();
}

class _ConversionPageState extends State<ConversionPage> {
  ConversionRepository? _repository;
  ConversionQuote? _quote;
  ConversionReceipt? _receipt;
  PendingConversion? _pending;
  List<ConversionReceipt> _history = [];
  int _page = 1, _total = 0;
  bool _busy = true,
      _consent = false,
      _restoring = false,
      _showSelection = true;
  String? _error;
  bool get _sameUser =>
      mounted && context.read<AuthProvider>().currentUser?.id == widget.userId;
  String _gp(int n) => n.toString().replaceAllMapped(
    RegExp(r'(\d)(?=(\d{3})+(?!\d))'),
    (m) => '${m[1]},',
  );
  String _date(DateTime d) {
    final t = d.toLocal();
    String two(int n) => '$n'.padLeft(2, '0');
    return '${t.year}.${two(t.month)}.${two(t.day)} ${two(t.hour)}:${two(t.minute)}';
  }

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _task(Future<void> Function() action) async {
    if (!_sameUser) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } catch (e) {
      if (_sameUser) {
        setState(
          () => _error = e is ApiException
              ? e.message
              : '결과를 확인하지 못했어요. 다시 확인해주세요.',
        );
      }
    } finally {
      try {
        final p = await _repository?.pending();
        if (_sameUser) _pending = p;
      } catch (_) {
        if (_sameUser) _error = '진행 기록을 읽지 못했어요. 저장소 상태를 확인한 뒤 다시 시도해주세요.';
      }
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _load() => _task(() async {
    _repository ??=
        widget.repository ?? await ConversionRepository.forUser(widget.userId);
    final repo = _repository!;
    if (repo.userId != widget.userId) throw StateError('wrong account');
    final pending = await repo.pending();
    if (!_sameUser) return;
    _pending = pending;
    _quote = null;
    _receipt = null;
    _consent = false;
    _restoring = false;
    if (pending != null) {
      final r = await repo.recover();
      if (_sameUser) _receipt = r;
    } else if (_showSelection && widget.inventoryIds != null) {
      final q = await repo.quote(widget.inventoryIds!);
      if (_sameUser) _quote = q;
    } else {
      final (rows, total) = await repo.list(_page);
      if (_sameUser) {
        _history = rows;
        _total = total;
      }
    }
  });
  Future<void> _completed(ConversionReceipt r) async {
    if (!_sameUser) return;
    setState(() {
      _receipt = r;
      _quote = null;
      _consent = false;
      _restoring = false;
      _showSelection = false;
    });
    await context.read<AuthProvider>().refreshProfile();
  }

  Future<void> _convert() async {
    if (_busy || !_consent || _quote == null) return;
    await _task(() async => _completed(await _repository!.convert(_quote!)));
  }

  Future<void> _retry() async {
    if (_busy || _pending == null) return;
    await _task(() async => _completed(await _repository!.retry()));
  }

  Future<void> _acknowledge() async {
    if (_busy || _receipt == null) return;
    await _task(() async {
      await _repository!.acknowledge(_receipt!);
      if (!_sameUser) return;
      _receipt = null;
      _showSelection = false;
      _page = 1;
      final (rows, total) = await _repository!.list(1);
      if (_sameUser) {
        _history = rows;
        _total = total;
      }
    });
  }

  Future<void> _detail(String id) async {
    if (_busy) return;
    await _task(() async {
      final r = await _repository!.detail(id);
      if (_sameUser) {
        _receipt = r;
        _consent = false;
        _restoring = false;
      }
    });
  }

  Future<void> _restore() async {
    if (_busy || !_consent || _receipt == null) return;
    await _task(
      () async => _completed(await _repository!.restore(_receipt!.id)),
    );
  }

  Widget _errorNotice() => Padding(
    padding: const EdgeInsets.symmetric(vertical: 12),
    child: Semantics(
      liveRegion: true,
      child: Text(
        _error!,
        style: TextStyle(color: Theme.of(context).colorScheme.error),
      ),
    ),
  );
  List<Widget> _items(List<ConversionEntry> entries) => entries.map((e) =>
    Padding(padding: const EdgeInsets.symmetric(vertical: GachiSpace.sm),
      child: GachiInfoCard(child: Column(crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [Text(e.prize.name, style: GachiType.product),
          const SizedBox(height: GachiSpace.sm),
          Text('${e.prize.displayGrade} · ${e.prize.premium ? '프리미엄' : '일반'}', style: GachiType.meta),
          const SizedBox(height: GachiSpace.sm),
          Text('${_gp(e.amount)} GP', style: GachiType.section),
        ])),
    )).toList();
  Widget _consentBox(String title) => CheckboxListTile(
    key: const Key('conversion-consent'),
    value: _consent,
    onChanged: _busy ? null : (v) => setState(() => _consent = v ?? false),
    contentPadding: EdgeInsets.zero,
    controlAffinity: ListTileControlAffinity.leading,
    title: Text(title),
  );
  List<Widget> _content() {
    final q = _quote, r = _receipt;
    if (r != null) {
      return [
        Text(
          r.restored ? '상품 복구 완료' : 'GP 전환 완료',
          style: GachiType.pageTitle,
        ),
        const SizedBox(height: 12),
        Text(
          '${r.entries.length}개 상품 · ${_gp(r.total)} GP',
          style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
        ),
        Text('${_date(r.createdAt)} 전환'),
        Text(
          r.restored
              ? '상품이 보관함으로 돌아왔어요.'
              : '전환 당시 잔액 ${_gp(r.balanceAfter)} GP',
        ),
        const SizedBox(height: 12),
        ..._items(r.entries),
        if (_pending != null)
          FilledButton(
            onPressed: _busy ? null : _acknowledge,
            child: const Text('확인하고 전환 내역 보기'),
          ),
        if (_pending == null && !r.restored) ...[
          Text('복구 가능 기한: ${_date(r.restoreUntil)}'),
          Text(
            r.canRestore
                ? '전환 이후 GP를 사용하지 않은 경우에만 복구할 수 있어요. 최종 가능 여부는 요청 시 다시 확인합니다.'
                : r.restoreReason ?? '현재 복구할 수 없습니다.',
          ),
          if (r.canRestore && !_restoring)
            OutlinedButton(
              onPressed: _busy
                  ? null
                  : () => setState(() {
                      _restoring = true;
                      _consent = false;
                    }),
              child: const Text('상품 복구 확인'),
            ),
          if (_restoring && r.canRestore) ...[
            _consentBox(
              '${_gp(r.total)} GP를 사용하여 ${r.entries.length}개 상품을 보관함으로 복구합니다.',
            ),
            FilledButton(
              key: const Key('restore-submit'),
              onPressed: _busy || !_consent ? null : _restore,
              child: const Text('GP를 차감하고 상품 복구'),
            ),
          ],
        ],
        if (_pending == null)
          TextButton(
            onPressed: _busy
                ? null
                : () {
                    _showSelection = false;
                    _load();
                  },
            child: const Text('전환 내역으로'),
          ),
      ];
    }
    if (_pending != null) {
      return [
        const Text(
          '이전 요청 결과 확인',
          style: GachiType.pageTitle,
        ),
        const SizedBox(height: 12),
        const Text(
          '통신이 끊겨도 요청 기록은 남아 있어요. 같은 요청으로 결과를 확인하며, 이미 처리된 상품을 다시 전환하지 않습니다.',
        ),
        const SizedBox(height: 16),
        FilledButton(
          onPressed: _busy ? null : _load,
          child: const Text('결과 다시 조회'),
        ),
        OutlinedButton(
          onPressed: _busy ? null : _retry,
          child: const Text('같은 요청으로 이어서 확인'),
        ),
      ];
    }
    if (q != null) {
      return [
        const Text(
          '상품을 GP로 전환할까요?',
          style: GachiType.pageTitle,
        ),
        const SizedBox(height: 16),
        GachiFlowSummary(title: '서버에서 확인한 전환 금액', value: '+ ${_gp(q.total)} GP',
          description: '현재 잔액 ${_gp(q.balance)} GP · 선택 ${q.entries.length}개'),
        const SizedBox(height: 16),
        ..._items(q.entries),
        Text(
          '전환 이후 GP를 사용하면 잔액이 다시 늘어도 상품을 복구할 수 없어요. 복구 기한은 전환 후 ${q.policy.hours}시간, 상품별 최대 ${q.policy.maxRestores}회입니다.',
        ),
        if (!q.restoreEligible)
          const Text('선택한 상품 중 복구 횟수를 모두 사용한 상품이 있어 이번 전환은 복구할 수 없습니다.'),
        _consentBox('전환 금액과 복구 조건을 확인했습니다.'),
        FilledButton(
          key: const Key('conversion-submit'),
          onPressed: _busy || !_consent ? null : _convert,
          child: Text('${_gp(q.total)} GP로 전환'),
        ),
      ];
    }
    return [
      const Text(
        '전환 내역',
        style: GachiType.pageTitle,
      ),
      const SizedBox(height: 8),
      const Text('전환한 상품과 복구 가능 여부를 확인하세요.'),
      if (_history.isEmpty && _error == null)
        const Padding(
          padding: EdgeInsets.all(24),
          child: Text('아직 전환 내역이 없어요. 보관함에서 상품을 선택해 전환할 수 있습니다.'),
        ),
      ..._history.map(
        (r) => Card(
          child: ListTile(
            title: Text('${r.entries.length}개 상품 · ${_gp(r.total)} GP'),
            subtitle: Text(
              '${_date(r.createdAt)} · ${r.restored ? '복구 완료' : '전환 완료'}',
            ),
            trailing: const Icon(Icons.chevron_right),
            onTap: _busy ? null : () => _detail(r.id),
          ),
        ),
      ),
      Wrap(
        alignment: WrapAlignment.spaceBetween,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          TextButton(
            onPressed: _busy || _page <= 1
                ? null
                : () {
                    _page--;
                    _load();
                  },
            child: const Text('이전'),
          ),
          Text('$_page / ${(_total / 20).ceil().clamp(1, 100000)}'),
          TextButton(
            onPressed: _busy || _page * 20 >= _total
                ? null
                : () {
                    _page++;
                    _load();
                  },
            child: const Text('다음'),
          ),
        ],
      ),
      OutlinedButton(
        onPressed: _busy ? null : _load,
        child: const Text('새로고침'),
      ),
    ];
  }

  @override
  Widget build(BuildContext context) {
    final sameUser =
        context.watch<AuthProvider>().currentUser?.id == widget.userId;
    return GachiFlowScaffold(
      appBar: AppBar(title: const Text('GP 전환 · 상품 복구')),
      body: SafeArea(
        child: !sameUser
            ? const Center(child: Text('전환한 계정으로 다시 로그인해주세요.'))
            : ListView(
                padding: const EdgeInsets.all(GachiSpace.page),
                children: [
                  if (_busy) const LinearProgressIndicator(),
                  if (_error != null) _errorNotice(),
                  if (!_busy ||
                      _quote != null ||
                      _receipt != null ||
                      _pending != null)
                    ..._content(),
                ],
              ),
      ),
    );
  }
}

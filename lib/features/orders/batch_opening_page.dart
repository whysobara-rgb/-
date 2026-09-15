import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import 'batch_opening.dart';
import 'order_models.dart';
import 'order_repository.dart';

class BatchOpeningPage extends StatefulWidget {
  final OrderRepository repository;
  final List<String>? initialIds;
  const BatchOpeningPage({
    super.key,
    required this.repository,
    this.initialIds,
  });
  @override
  State<BatchOpeningPage> createState() => _BatchOpeningPageState();
}

class _BatchOpeningPageState extends State<BatchOpeningPage>
    with WidgetsBindingObserver {
  BatchOpening? _batch;
  bool _busy = true, _continue = false, _working = false;
  String? _error;
  String _grade = '전체';
  bool get _sameUser =>
      mounted &&
      context.read<AuthProvider>().currentUser?.id == widget.repository.userId;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  @override
  void dispose() {
    _continue = false;
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state != AppLifecycleState.resumed && mounted) {
      setState(() => _continue = false);
    }
  }

  String _message(Object e) =>
      e is ApiException ? e.message : '기록을 저장하거나 결과를 확인하지 못했어요. 이어서 확인해주세요.';

  Future<void> _load() async {
    if (!_sameUser) return;
    try {
      final batch = widget.initialIds == null
          ? await widget.repository.pendingBatch()
          : await widget.repository.startBatch(widget.initialIds!);
      if (!_sameUser) return;
      setState(() {
        _batch = batch;
        _busy = false;
      });
      if (widget.initialIds != null && batch != null) await _run();
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = _message(e);
          _busy = false;
        });
      }
    }
  }

  Future<void> _run() async {
    if (_working || _busy || !_sameUser || _batch?.complete == true) return;
    _working = true;
    setState(() {
      _continue = true;
      _error = null;
    });
    try {
      while (_continue && _sameUser && _batch?.complete == false) {
        final next = await widget.repository.advanceBatch();
        if (!_sameUser) break;
        setState(() => _batch = next);
      }
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      try {
        final latest = await widget.repository.pendingBatch();
        if (_sameUser && latest != null) _batch = latest;
      } catch (_) {
        /* Keep the existing error and leave the durable queue untouched. */
      }
      _working = false;
      _continue = false;
      if (mounted) setState(() {});
    }
  }

  Future<void> _close() async {
    if (_working || _batch == null || !_sameUser) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.repository.acknowledgeBatch(_batch!.id);
      if (mounted && _sameUser) Navigator.pop(context);
    } catch (e) {
      if (mounted) setState(() => _error = _message(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  List<Widget> _results(List<Opening> results) {
    final grouped = <String, List<Opening>>{};
    for (final r in results) {
      if (_grade != '전체' && r.prize.displayGrade != _grade) continue;
      final key =
          '${r.prize.itemId}/${r.prize.rarity}/${r.prize.name}/${r.prize.conversionGP}';
      grouped.putIfAbsent(key, () => []).add(r);
    }
    return grouped.values.map((group) {
      final p = group.first.prize;
      return Card(
        child: ListTile(
          leading: SizedBox(
            width: 52,
            height: 52,
            child: p.imageUrl == null
                ? const Icon(Icons.inventory_2_outlined)
                : ClipRRect(
                    borderRadius: BorderRadius.circular(10),
                    child: Image.network(
                      p.imageUrl!,
                      fit: BoxFit.cover,
                      errorBuilder: (_, e, st) =>
                          const Icon(Icons.inventory_2_outlined),
                    ),
                  ),
          ),
          title: Text(p.name),
          subtitle: Text('${p.displayGrade} · 보관함에 저장됨'),
          trailing: Text(
            '× ${group.length}',
            style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18),
          ),
        ),
      );
    }).toList();
  }

  @override
  Widget build(BuildContext context) {
    final sameUser =
        context.watch<AuthProvider>().currentUser?.id ==
        widget.repository.userId;
    final b = _batch;
    return Scaffold(
      appBar: AppBar(title: const Text('일괄 개봉')),
      body: SafeArea(
        child: !sameUser
            ? const Center(child: Text('구매한 계정으로 다시 로그인해주세요.'))
            : _busy
            ? const Center(child: CircularProgressIndicator())
            : ListView(
                padding: const EdgeInsets.all(20),
                children: [
                  if (b != null) ...[
                    Text(
                      b.complete
                          ? '${b.results.length}개 개봉 완료'
                          : _working
                          ? '박스를 열고 있어요'
                          : '이어서 열어볼까요?',
                      style: Theme.of(context).textTheme.headlineSmall
                          ?.copyWith(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      '${b.results.length} / ${b.capsuleIds.length}개 · 추가 결제 0 GP',
                    ),
                    const SizedBox(height: 16),
                    LinearProgressIndicator(
                      value: b.results.length / b.capsuleIds.length,
                    ),
                    const SizedBox(height: 16),
                    if (_working) ...[
                      Text(
                        _continue
                            ? '앱을 닫아도 확인된 결과는 보관함에 남아요.'
                            : '현재 박스의 결과를 확인한 뒤 멈춥니다.',
                      ),
                      const SizedBox(height: 12),
                      OutlinedButton(
                        onPressed: _continue
                            ? () => setState(() => _continue = false)
                            : null,
                        child: const Text('현재 박스까지 열고 멈추기'),
                      ),
                    ] else if (!b.complete) ...[
                      Text(
                        '남은 ${b.remaining}개를 이어서 확인합니다. 이미 열린 박스는 다시 추첨하지 않아요.',
                      ),
                      const SizedBox(height: 12),
                      FilledButton(
                        onPressed: _run,
                        child: Text(
                          b.inFlight == null
                              ? '남은 박스 이어서 개봉'
                              : '처리 중인 결과 확인 후 이어가기',
                        ),
                      ),
                    ],
                  ],
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      child: Semantics(
                        liveRegion: true,
                        child: Text(
                          _error!,
                          style: TextStyle(
                            color: Theme.of(context).colorScheme.error,
                          ),
                        ),
                      ),
                    ),
                  if (b == null) ...[
                    Text(
                      _error == null
                          ? '진행 중인 일괄 개봉이 없습니다.'
                          : '진행 기록을 확인하지 못했습니다. 보관함에서 다시 확인해주세요.',
                    ),
                    OutlinedButton(
                      onPressed: () => Navigator.pop(context),
                      child: const Text('미개봉 보관함으로'),
                    ),
                  ],
                  if (b != null && b.results.isNotEmpty) ...[
                    const SizedBox(height: 24),
                    const Text(
                      '확인된 상품',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Wrap(
                      spacing: 8,
                      children: ['전체', 'B', 'A', 'S', 'SSS']
                          .map(
                            (g) => ChoiceChip(
                              label: Text(
                                '$g ${g == '전체' ? b.results.length : b.results.where((r) => r.prize.displayGrade == g).length}',
                              ),
                              selected: _grade == g,
                              onSelected: (_) => setState(() => _grade = g),
                            ),
                          )
                          .toList(),
                    ),
                    ..._results(b.results),
                  ],
                  if (b != null && !_working && b.inFlight == null) ...[
                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _close,
                      child: Text(
                        b.complete ? '결과 확인 완료' : '여기까지 확인하고 나머지는 보관하기',
                      ),
                    ),
                  ],
                ],
              ),
      ),
    );
  }
}

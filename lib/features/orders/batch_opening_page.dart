import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import 'batch_opening.dart';
import '../../shared/widgets/gachi_components.dart';
import '../../shared/widgets/gachi_opening.dart';
import '../inventory/presentation/inventory_page.dart';
import 'batch_result_view.dart';
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

  @override
  Widget build(BuildContext context) {
    final sameUser =
        context.watch<AuthProvider>().currentUser?.id ==
        widget.repository.userId;
    final b = _batch;
    return GachiOpeningTheme(
      child: Scaffold(
        appBar: AppBar(title: const Text('일괄 개봉')),
        body: SafeArea(
          child: !sameUser
              ? const Center(child: Text('구매한 계정으로 다시 로그인해주세요.'))
              : ListView(
                  padding: const EdgeInsets.all(GachiSpace.page),
                  children: [
                    if (_busy)
                      const GachiOpeningHeading(
                        title: '개봉을 준비하고 있어요',
                        description: '저장된 기록을 확인합니다.',
                      ),
                    if (!_busy && b != null)
                      BatchResultView(
                        batch: b,
                        working: _working,
                        continuing: _continue,
                        grade: _grade,
                        error: _error,
                        onGrade: (grade) => setState(() => _grade = grade),
                        onStop: () => setState(() => _continue = false),
                        onResume: _run,
                        onClose: _close,
                        onCollection: () => Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (_) => const InventoryPage(),
                          ),
                        ),
                      ),
                    if (!_busy && b == null) ...[
                      Text(_error ?? '진행 중인 일괄 개봉이 없습니다.'),
                      GachiSecondaryButton(
                        label: '미개봉 보관함으로',
                        onPressed: () => Navigator.pop(context),
                      ),
                    ],
                  ],
                ),
        ),
      ),
    );
  }
}

import '../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../core/network/api_client.dart';
import '../../shared/providers/auth_provider.dart';
import '../customer_updates/customer_updates_page.dart';
import 'refund_models.dart';
import 'refund_repository.dart';

String _error(Object error) {
  if (error is ApiSessionChangedException) return '로그인 상태가 바뀌었습니다. 다시 로그인해주세요.';
  if (error is ApiException && error.httpStatusCode == 404) return '이 서버에서 내역을 찾지 못했습니다. 서버 반영 상태와 주문을 확인해주세요.';
  if (error is ApiException && {400,409}.contains(error.httpStatusCode)) return '주문 상태나 환불 조건을 다시 확인해주세요. 자동 환불 대상 확인이 어려우면 고객지원에 문의해주세요.';
  return '처리 결과를 확인하지 못했습니다. 새 요청을 만들지 말고 기존 요청 결과를 다시 조회해주세요.';
}
String _date(DateTime d) => d.toLocal().toString().split('.').first;
Future<bool> _confirm(BuildContext context, String title, String body) async =>
    await showDialog<bool>(context: context, builder: (c) => GachiFlowDialog(
      scrollable: true, title: Text(title), content: Text(body), actions: [
        TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')),
        FilledButton(key: const Key('refund-confirm'), onPressed: () => Navigator.pop(c, true), child: const Text('확인 후 실행')),
      ],
    )) == true;

class _RecoveryCard extends StatelessWidget {
  final PendingRefund pending;
  final RefundRecovery? recovery;
  final bool busy, canRequest;
  final VoidCallback onRefresh, onRetry, onAcknowledge;
  const _RecoveryCard({required this.pending, required this.recovery,
      required this.busy, required this.canRequest, required this.onRefresh,
      required this.onRetry, required this.onAcknowledge});
  @override
  Widget build(BuildContext context) {
    final receipt = recovery?.receipt;
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('이전 환불 요청 확인', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        GachiReference('문의용 요청번호: ${pending.key}'),
        Text('${pending.ids.length}개 · ${refundMoney(pending.amount, pending.currency)}'),
        Text(receipt != null ? orderStateLabel(receipt.status)
            : recovery == null ? '아직 처리 결과를 확인하지 못했습니다.'
            : '현재 서버 기록 미확인 — 요청 실패가 확정된 것은 아닙니다.'),
        if (receipt?.status == 'UNKNOWN' || receipt?.status == 'PROCESSING')
          const Text('결제사 확인이 필요합니다. 새 환불이나 자동 재요청 없이 기존 결과를 조회합니다.'),
        OutlinedButton(key: const Key('refund-recover'), onPressed: busy ? null : onRefresh,
            child: const Text('기존 요청 결과 조회')),
        if (recovery?.retryAllowed == true && canRequest)
          OutlinedButton(key: const Key('refund-retry'), onPressed: busy ? null : onRetry,
              child: const Text('같은 요청번호로 처리 재개')),
        if (receipt?.succeeded == true)
          FilledButton(key: const Key('refund-ack'), onPressed: busy ? null : onAcknowledge,
              child: const Text('완료 내역 확인')),
      ],
    )));
  }
}

class OrderHistoryPage extends StatefulWidget {
  final RefundRepository? repository;
  const OrderHistoryPage({super.key, this.repository});
  @override
  State<OrderHistoryPage> createState() => _OrderHistoryPageState();
}
class _OrderHistoryPageState extends State<OrderHistoryPage> {
  late final AuthProvider _auth;
  late final int _session;
  RefundRepository? _repo;
  bool _busy = false, _confirming = false, _ended = false, _refunds = false;
  int _generation = 0, _page = 0, _total = 0;
  String? _message;
  List<OrderSummary> _orders = [];
  List<RefundReceipt> _receipts = [];
  PendingRefund? _pending;
  RefundRecovery? _recovery;
  bool get _current => mounted && !_ended && _auth.isSessionCurrent(_session);
  @override
  void initState() {
    super.initState(); _auth = context.read<AuthProvider>();
    _session = _auth.sessionGeneration; _auth.addListener(_changed);
    Future<void>.microtask(_load);
  }
  void _changed() {
    if (!mounted || _auth.isSessionCurrent(_session)) return;
    _generation++;
    setState(() { _ended = true; _busy = false; _orders = []; _receipts = [];
      _pending = null; _recovery = null; _message = '로그인 상태가 바뀌었습니다. 다시 로그인해주세요.'; });
  }
  Future<void> _load({bool append = false}) async {
    if (!_current) { _changed(); return; }
    final generation = ++_generation;
    final next = append ? _page + 1 : 1;
    setState(() { _busy = true; _message = null;
      if (!append) { _page = 0; _total = 0; _orders = []; _receipts = []; _pending = null; _recovery = null; } });
    try {
      _repo ??= widget.repository ?? await RefundRepository.forUser(_auth.currentUser!.id, () => _current);
      final p = await _repo!.pending();
      if (!_current || generation != _generation) return;
      setState(() { _pending = p; });
      if (_refunds) {
        final (rows, total) = await _repo!.refunds(next);
        if (!_current || generation != _generation) return;
        if (append && (total != _total || rows.any((r) => _receipts.any((x) => x.id == r.id)))) {
          throw const FormatException('History changed; refresh required');
        }
        setState(() { _receipts = [..._receipts, ...rows]; _total = total; _page = next; });
      } else {
        final (rows, total) = await _repo!.orders(next);
        if (!_current || generation != _generation) return;
        if (append && (total != _total || rows.any((r) => _orders.any((x) => x.id == r.id)))) {
          throw const FormatException('History changed; refresh required');
        }
        setState(() { _orders = [..._orders, ...rows]; _total = total; _page = next; });
      }
    } catch (e) {
      if (_current && generation == _generation) setState(() { _message = _error(e); });
    } finally {
      if (_current && generation == _generation) setState(() { _busy = false; });
    }
  }
  Future<bool> _confirmAction(String title, String body) async {
    if (!_current) return false;
    setState(() { _confirming = true; });
    try { return await _confirm(context, title, body); }
    finally { if (mounted) setState(() { _confirming = false; }); }
  }
  Future<void> _recover({bool retry = false, bool acknowledge = false}) async {
    if (!_current || _busy || _repo == null) return;
    setState(() { _busy = true; _message = null; _recovery = null; });
    try {
      if (retry) {
        if (!await _confirmAction('같은 환불 요청을 재개할까요?', '저장된 요청번호·캡슐·금액을 그대로 사용합니다. 결제사 확인 중인 요청은 다시 취소하지 않습니다.') || !_current) return;
        await _repo!.retry();
      }
      if (acknowledge) {
        await _repo!.acknowledge();
        if (_current) await _auth.refreshProfile();
      }
      final r = await _repo!.recover();
      if (_current) setState(() { _pending = r?.pending; _recovery = r; });
    } catch (e) { if (_current) setState(() { _message = _error(e); }); }
    finally { if (_current) setState(() { _busy = false; }); }
  }
  Future<void> _open(String id) async {
    if (!_current || _busy || _repo == null) return;
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => OrderRefundPage(orderId: id, repository: _repo!)));
    if (_current) await _load();
  }
  @override
  Widget build(BuildContext context) => GachiFlowScaffold(
    appBar: AppBar(title: const Text('주문·환불 내역')),
    body: ListView(padding: const EdgeInsets.all(GachiSpace.page), children: [
      const GachiFlowHeading(label: 'ORDERS & REFUNDS', title: '나의 주문',
        description: '구매한 상품과 환불 진행 상태를 확인하세요.'),
      if (_ended) Text(_message ?? '다시 로그인해주세요.') else ...[
        Wrap(spacing: 8, runSpacing: 8, children: [
          ChoiceChip(label: const Text('주문 내역'), selected: !_refunds,
              onSelected: _busy ? null : (_) { setState(() { _refunds = false; }); _load(); }),
          ChoiceChip(label: const Text('환불 내역'), selected: _refunds,
              onSelected: _busy ? null : (_) { setState(() { _refunds = true; }); _load(); }),
          OutlinedButton(onPressed: _busy ? null : _load, child: const Text('새로고침')),
        ]),
        if (_pending != null) _RecoveryCard(pending: _pending!, recovery: _recovery,
            busy: _busy, canRequest: _repo?.canRequest ?? false,
            onRefresh: () => _recover(), onRetry: () => _recover(retry: true),
            onAcknowledge: () => _recover(acknowledge: true)),
        if (_message != null) Semantics(liveRegion: true, child: Text(_message!)),
        if (_busy && !_confirming) const LinearProgressIndicator(semanticsLabel: '내역 확인 중'),
        if (!_busy && _message == null && _page > 0 && _total == 0)
          Text(_refunds ? '환불 내역이 없습니다.' : '구매한 주문이 없습니다.'),
        if (!_refunds) for (final o in _orders) Card(child: ListTile(
          key: Key('history-order-${o.id}'), title: Text(o.title),
          subtitle: Text('${orderStateLabel(o.status)} · ${o.quantity}개\n${refundMoney(o.total, o.currency)}\n${_date(o.createdAt)}'),
          trailing: const Icon(Icons.chevron_right), onTap: _busy ? null : () => _open(o.id),
        )),
        if (_refunds) for (final r in _receipts) Card(child: ListTile(
          key: Key('history-refund-${r.id}'), title: Text(orderStateLabel(r.status)),
          subtitle: Text('${r.ids.length}개 · ${refundMoney(r.amount, r.currency)}\n${r.currency == 'KRW' ? '원결제 카드 취소' : 'GP 원결제 환급'}\n${_date(r.createdAt)}'),
          trailing: const Icon(Icons.chevron_right), onTap: _busy ? null : () => _open(r.orderId),
        )),
        if ((_refunds ? _receipts.length : _orders.length) < _total)
          OutlinedButton(onPressed: _busy ? null : () => _load(append: true), child: const Text('다음 내역')),
      ],
    ]),
  );
  @override
  void dispose() { _generation++; _auth.removeListener(_changed); super.dispose(); }
}

class OrderRefundPage extends StatefulWidget {
  final String orderId;
  final RefundRepository repository;
  const OrderRefundPage({super.key, required this.orderId, required this.repository});
  @override
  State<OrderRefundPage> createState() => _OrderRefundPageState();
}
class _OrderRefundPageState extends State<OrderRefundPage> {
  late final AuthProvider _auth;
  late final int _session;
  bool _busy = false, _confirming = false, _ended = false, _consent = false;
  int _generation = 0;
  String? _message;
  RefundOrder? _order;
  RefundCapabilities? _cap;
  RefundQuote? _quote;
  PendingRefund? _pending;
  RefundRecovery? _recovery;
  final Set<String> _selected = {};
  final TextEditingController _reason = TextEditingController();
  bool get _current => mounted && !_ended && _auth.isSessionCurrent(_session);
  bool get _requestEnabled => _current && widget.repository.canRequest && _cap?.enabled == true &&
      (_order?.summary.currency != 'KRW' || _cap?.cashEnabled == true);
  @override
  void initState() {
    super.initState(); _auth = context.read<AuthProvider>(); _session = _auth.sessionGeneration;
    _auth.addListener(_changed); Future<void>.microtask(_load);
  }
  void _changed() {
    if (!mounted || _auth.isSessionCurrent(_session)) return;
    _generation++; _reason.clear();
    setState(() { _ended = true; _busy = false; _order = null; _cap = null; _quote = null;
      _pending = null; _recovery = null; _selected.clear(); _message = '로그인 상태가 바뀌었습니다. 다시 로그인해주세요.'; });
  }
  Future<void> _load() async {
    if (!_current) { _changed(); return; }
    final g = ++_generation;
    setState(() { _busy = true; _message = null; _order = null; _cap = null;
      _quote = null; _consent = false; _selected.clear(); _recovery = null; });
    try {
      final p = await widget.repository.pending();
      final o = await widget.repository.order(widget.orderId);
      final c = await widget.repository.capabilities();
      if (!_current || g != _generation) return;
      setState(() { _pending = p; _order = o; _cap = c; });
    } catch (e) { if (_current && g == _generation) setState(() { _message = _error(e); }); }
    finally { if (_current && g == _generation) setState(() { _busy = false; }); }
  }
  Future<void> _quoteNow() async {
    if (!_requestEnabled || _busy || _order == null || _pending != null || _selected.isEmpty) return;
    setState(() { _busy = true; _message = null; _quote = null; _consent = false; });
    try {
      final q = await widget.repository.quote(_order!, _selected.toList());
      if (_current) setState(() { _quote = q; });
    } catch (e) { if (_current) setState(() { _message = _error(e); }); }
    finally { if (_current) setState(() { _busy = false; }); }
  }
  Future<void> _submit() async {
    if (!_requestEnabled || _busy || _quote == null || !_consent || _pending != null) return;
    final q = _quote!, reason = _reason.text.trim();
    if (reason.isEmpty || reason.length > 255 || RegExp(r'[\x00-\x1f\x7f]').hasMatch(reason)) {
      setState(() { _message = '환불 사유를 한 줄로 1~255자 입력해주세요.'; }); return;
    }
    setState(() { _busy = true; _message = null; });
    try {
      if (!await _confirmAction('미개봉 캡슐 환불 신청',
          '${q.ids.length}개 · ${refundMoney(q.amount, q.currency)}\n${q.currency == 'KRW' ? '원결제 카드 거래를 취소합니다. GP로 지급하지 않습니다.' : '원래 사용한 GP로 환급합니다. 현금 출금이 아닙니다.'}\n처리 중인 캡슐은 개봉할 수 없습니다.') || !_current) { return; }
      await widget.repository.submit(q, reason);
      if (!_current) return;
      _reason.clear();
      final r = await widget.repository.recover();
      if (_current) setState(() { _pending = r?.pending; _recovery = r; _quote = null; _consent = false; });
    } catch (e) {
      if (_current) {
        PendingRefund? p;
        try { p = await widget.repository.pending(); } catch (_) { /* no false success */ }
        if (_current) setState(() { _pending = p; _message = _error(e); _quote = null; _consent = false; });
      }
    } finally { if (_current) setState(() { _busy = false; }); }
  }
  Future<bool> _confirmAction(String title, String body) async {
    if (!_current) return false;
    setState(() { _confirming = true; });
    try { return await _confirm(context, title, body); }
    finally { if (mounted) setState(() { _confirming = false; }); }
  }
  Future<void> _recover({bool retry = false, bool acknowledge = false}) async {
    if (!_current || _busy) return;
    setState(() { _busy = true; _message = null; _recovery = null; });
    try {
      if (retry) {
        if (!await _confirmAction('같은 환불 요청을 재개할까요?', '저장된 요청번호·금액·대상을 변경하지 않고 확인합니다. 결제사 확인 중인 요청은 취소를 재전송하지 않습니다.') || !_current) return;
        await widget.repository.retry();
      }
      if (acknowledge) {
        await widget.repository.acknowledge();
        if (_current) await _auth.refreshProfile();
      }
      final r = await widget.repository.recover();
      if (_current) setState(() { _pending = r?.pending; _recovery = r; });
    } catch (e) { if (_current) setState(() { _message = _error(e); }); }
    finally { if (_current) setState(() { _busy = false; }); }
    if (acknowledge && _current && _pending == null) await _load();
  }
  @override
  Widget build(BuildContext context) {
    final order = _order;
    return PopScope(canPop: !_busy, child: GachiFlowScaffold(
      appBar: AppBar(title: const Text('주문 상세·환불')),
      body: GachiFlowList(padding: const EdgeInsets.all(GachiSpace.page), children: [
        if (_message != null) Semantics(liveRegion: true, child: Text(_message!, key: const Key('refund-message'))),
        if (_ended) const Text('현재 화면의 거래 자료를 지웠습니다.') else ...[
          if (_busy && !_confirming) const LinearProgressIndicator(semanticsLabel: '주문 처리 확인 중'),
          OutlinedButton(onPressed: _busy ? null : _load, child: const Text('주문 새로고침')),
          if (_pending != null) _RecoveryCard(pending: _pending!, recovery: _recovery,
              busy: _busy, canRequest: widget.repository.canRequest,
              onRefresh: () => _recover(), onRetry: () => _recover(retry: true),
              onAcknowledge: () => _recover(acknowledge: true)),
          if (order != null) ...[
            GachiFlowHeading(label: 'ORDER DETAIL', title: order.summary.title),
            GachiFlowSummary(title: orderStateLabel(order.summary.status),
              value: refundMoney(order.summary.total, order.summary.currency),
              description: '주문 ${_date(order.summary.createdAt)}'),
            Text('구매 ${order.summary.quantity}개 · 미개봉 ${order.summary.unopenedCount}개 · 환불 완료 ${order.summary.refundedQuantity}개'),
            GachiReference('문의용 주문번호: ${order.summary.id}'),
            if (order.summary.refundUntil != null) Text('주문에 기록된 자동 환불 기한: ${_date(order.summary.refundUntil!)}'),
            if (!order.summary.refundEligible || order.summary.refundUntil == null)
              const Text('앱에서 자동 환불 대상 여부를 확인할 수 없습니다. 이 표시가 모든 환불 권리를 부정하는 것은 아닙니다. 고객지원에서 구매 당시 조건을 확인해주세요.'),
            if (!_requestEnabled) const Text('현재 앱 또는 서버에서 환불 신청을 준비하고 있습니다. 내역 조회는 가능합니다.'),
            const SizedBox(height: 16),
            const GachiSectionHeader(title: '환불할 미개봉 캡슐'),
            for (final c in order.capsules) CheckboxListTile(
              key: Key('refund-capsule-${c.id}'), contentPadding: EdgeInsets.zero,
              title: Text('캡슐 ${c.sequence} · ${orderStateLabel(c.status)}'),
              value: _selected.contains(c.id),
              onChanged: !_requestEnabled || _busy || _pending != null || c.status != 'UNOPENED' || !order.summary.refundEligible
                  ? null : (v) => setState(() { v == true ? _selected.add(c.id) : _selected.remove(c.id); _quote = null; _consent = false; }),
            ),
            OutlinedButton(key: const Key('refund-quote'),
                onPressed: !_requestEnabled || _busy || _pending != null || _selected.isEmpty ? null : _quoteNow,
                child: const Text('선택한 캡슐 환불 견적 확인')),
            if (_quote != null) ...[
              Text('서버 확인: ${_quote!.ids.length}개 · ${refundMoney(_quote!.amount, _quote!.currency)}'),
              Text(_quote!.currency == 'KRW' ? '원결제 카드 취소 · 실제 입금 시점은 결제사 처리에 따릅니다.' : '원래 사용한 GP 환급 · 현금 출금 아님'),
              TextField(key: const Key('refund-reason'), controller: _reason, enabled: !_busy,
                  maxLength: 255, decoration: const InputDecoration(labelText: '환불 사유')),
              CheckboxListTile(key: const Key('refund-consent'), value: _consent,
                  onChanged: _busy ? null : (v) => setState(() { _consent = v == true; }),
                  title: const Text('선택한 캡슐과 원결제수단·환불 금액을 확인했습니다.')),
              FilledButton(key: const Key('refund-submit'),
                  onPressed: _busy || !_consent || _pending != null ? null : _submit,
                  child: const Text('미개봉 환불 신청')),
            ],
            const SizedBox(height: 16),
            OutlinedButton(onPressed: _busy ? null : () => Navigator.of(context).push(MaterialPageRoute(
                builder: (_) => const CustomerUpdatesPage(initial: 'tickets'))), child: const Text('환불 관련 고객지원')),
          ],
        ],
      ]),
    ));
  }
  @override
  void dispose() { _generation++; _auth.removeListener(_changed); _reason.dispose(); super.dispose(); }
}

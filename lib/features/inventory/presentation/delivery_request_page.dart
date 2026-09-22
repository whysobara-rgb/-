import '../../../shared/widgets/gachi_flow.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/config/app_config.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../orders/order_repository.dart';
import '../../shipping/fulfillment_repository.dart';
import '../domain/inventory_item.dart';

class DeliveryRequestPage extends StatefulWidget {
  final List<InventoryItem> items;
  final FulfillmentRepository? repository;
  const DeliveryRequestPage({super.key, required this.items, this.repository});
  @override
  State<DeliveryRequestPage> createState() => _DeliveryRequestPageState();
}

class _DeliveryRequestPageState extends State<DeliveryRequestPage> {
  final fields = {
    for (final key in recipientFields.where((x) => x != 'country'))
      key: TextEditingController(),
  };
  FulfillmentRepository? repository;
  ShippingQuote? quote;
  Map<String, dynamic>? pending;
  bool busy = true, confirmed = false;
  String? error;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => init());
  }

  Future<void> init() async {
    try {
      final id = context.read<AuthProvider>().currentUser?.id;
      if (id == null) {
        throw Exception('다시 로그인해주세요');
      }
      final r = widget.repository ?? FulfillmentRepository(await OrderRepository.forUser(id));
      final p = await r.pending();
      if (mounted) {
        setState(() {
          repository = r;
          pending = p;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => error = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  Future<void> perform(Future<void> Function() action) async {
    if (busy || repository == null) {
      return;
    }
    setState(() {
      busy = true;
      error = null;
    });
    try {
      await action();
    } catch (e) {
      if (mounted) {
        setState(() => error = e.toString());
      }
    } finally {
      try {
        final p = await repository!.pending();
        if (mounted) {
          setState(() => pending = p);
        }
      } catch (_) {
        if (mounted) {
          setState(() {
            repository = null;
            error = '배송 복구 기록을 읽지 못했습니다. 화면을 다시 열어주세요.';
          });
        }
      }
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  Future<void> getQuote() => perform(() async {
    if (widget.items.isEmpty || widget.items.any((i) => !i.canShip)) {
      throw Exception('배송 가능한 상품을 다시 선택해주세요');
    }
    final recipient = {
      for (final e in fields.entries) e.key: e.value.text.trim(),
      'country': 'KR',
    };
    recipient['phone'] = recipient['phone']!.replaceAll(RegExp(r'[\s-]'), '');
    final q = await repository!.quote(
      widget.items.map((i) => int.parse(i.id)).toList(),
      recipient,
    );
    if (mounted) {
      setState(() {
        quote = q;
        confirmed = false;
      });
    }
  });
  Future<void> send() => perform(() async {
    final result = pending != null
        ? await repository!.recover()
        : await repository!.submit(quote!);
    if (!mounted || result == null) {
      return;
    }
    await context.read<AuthProvider>().refreshProfile();
    if (!mounted) {
      return;
    }
    await showDialog<void>(
      context: context,
      builder: (c) => GachiFlowDialog(
        title: Text(
          result.status.name == 'cancelled' ? '배송 취소를 확인했어요' : '배송 신청을 확인했어요',
        ),
        content: SelectableText('배송번호 ${result.id}\n배송 내역에서 진행 상태를 확인하세요.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(c),
            child: const Text('확인'),
          ),
        ],
      ),
    );
    if (mounted) {
      Navigator.of(context).pop(true);
    }
  });
  @override
  void dispose() {
    for (final c in fields.values) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => GachiFlowScaffold(
    appBar: AppBar(title: const Text('배송 신청·결과 확인')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(GachiSpace.page),
        children: [
          const GachiFlowHeading(label: 'DELIVERY', title: '소중한 상품을 집으로',
            description: '받는 정보와 서버에서 확인한 배송비를 살펴보세요.'),
          if (busy) const LinearProgressIndicator(),
          if (error != null)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 12),
              child: Text(error!),
            ),
          if (pending != null) ...[
            const Text('결과를 확인하지 못한 이전 배송 요청이 있습니다. 같은 요청번호로 확인합니다.'),
            FilledButton(
              onPressed: busy ? null : send,
              child: const Text('이전 배송 요청 결과 확인'),
            ),
          ] else if (!AppConfig.shippingPreviewEnabled)
            const Text('배송 서비스를 준비하고 있습니다. 기존 배송 상태는 배송 내역에서 확인하세요.')
          else if (widget.items.isEmpty)
            const Text('확인할 요청이 없습니다. 보관함에서 배송할 상품을 선택해주세요.')
          else if (quote == null) ...[
            Text(
              '선택 상품 ${widget.items.length}개',
              style: GachiType.section,
            ),
            for (final item in widget.items) Text(item.name),
            const SizedBox(height: 20),
            for (final e in const {
              'name': '수령인',
              'phone': '연락처',
              'postalCode': '우편번호 (5자리)',
              'address1': '기본 주소',
              'address2': '상세 주소',
              'notes': '요청사항 (선택)',
            }.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: TextField(
                  controller: fields[e.key],
                  enabled: !busy,
                  maxLength: e.key == 'notes'
                      ? 200
                      : e.key == 'address1' || e.key == 'address2'
                      ? 200
                      : 50,
                  keyboardType: e.key == 'phone'
                      ? TextInputType.phone
                      : e.key == 'postalCode'
                      ? TextInputType.number
                      : TextInputType.text,
                  decoration: InputDecoration(labelText: e.value),
                ),
              ),
            const Text('배송비는 주소와 서버 배송 정책에 따라 견적에서 확인합니다.'),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: busy || repository == null ? null : getQuote,
              child: const Text('배송비·신청 내용 확인'),
            ),
          ] else ...[
            const Text(
              '배송 신청 최종 확인',
              style: GachiType.section,
            ),
            const SizedBox(height: 16),
            GachiFlowSummary(title: '상품 ${quote!.ids.length}개 · 배송 견적',
              value: '${quote!.fee} GP', description: '현재 잔액 ${quote!.balance} GP'),
            const SizedBox(height: 16),
            for (final key in [
              'name',
              'phone',
              'postalCode',
              'address1',
              'address2',
              'notes',
            ])
              Text(quote!.recipient[key]),
            Text('견적 만료 ${quote!.expiresAt.toLocal()}'),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: confirmed,
              onChanged: busy
                  ? null
                  : (v) => setState(() => confirmed = v ?? false),
              title: const Text('선택 상품·주소·배송비를 확인했습니다.'),
            ),
            FilledButton(
              onPressed: busy || !confirmed || quote!.balance < quote!.fee
                  ? null
                  : send,
              child: Text('${quote!.fee} GP로 배송 신청'),
            ),
            TextButton(
              onPressed: busy ? null : () => setState(() => quote = null),
              child: const Text('주소 수정·견적 다시 받기'),
            ),
          ],
        ],
      ),
    ),
  );
}

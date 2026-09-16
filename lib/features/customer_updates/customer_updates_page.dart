import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../shared/providers/auth_provider.dart';
import '../../shared/widgets/activity_feed.dart';
import '../../shared/data/activity_page.dart';
import '../home/data/capsule_box_repository.dart';
import '../home/domain/capsule_box.dart';
import '../gacha/presentation/gacha_detail_page.dart';
import '../wallet/presentation/wallet_page.dart';
import '../orders/order_repository.dart';
import 'customer_content.dart';
import 'support_repository.dart';

const caseStates = {
  'OPEN': '접수',
  'IN_PROGRESS': '처리 중',
  'WAITING_EXTERNAL': '외부 확인 중',
  'CLOSED': '처리 종료',
};

class CustomerUpdatesPage extends StatefulWidget {
  final String initial;
  final CustomerContentRepository repository;
  const CustomerUpdatesPage({
    super.key,
    this.initial = 'events',
    this.repository = const CustomerContentRepository(),
  });
  @override
  State<CustomerUpdatesPage> createState() => _CustomerUpdatesPageState();
}

class _CustomerUpdatesPageState extends State<CustomerUpdatesPage> {
  late String kind = widget.initial;
  int revision = 0;
  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('소식·고객지원'),
      actions: [
        IconButton(
          tooltip: '새로고침',
          onPressed: () => setState(() => revision++),
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: SafeArea(
      child: Column(
        children: [
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children:
                  const {
                        'events': '이벤트',
                        'notices': '공지',
                        'inbox': '알림',
                        'tickets': '내 문의',
                        'cases': '처리 현황',
                      }.entries
                      .map(
                        (e) => Padding(
                          padding: const EdgeInsets.only(right: 8),
                          child: ChoiceChip(
                            label: Text(e.value),
                            selected: kind == e.key,
                            onSelected: (_) => setState(() => kind = e.key),
                          ),
                        ),
                      )
                      .toList(),
            ),
          ),
          if (kind == 'tickets')
            Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton.icon(
                onPressed: () async {
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const SupportComposePage(),
                    ),
                  );
                  if (mounted) {
                    setState(() => revision++);
                  }
                },
                icon: const Icon(Icons.edit_note),
                label: const Text('문의 작성 · 전송 결과 확인'),
              ),
            ),
          Expanded(
            child: kind == 'events'
                ? CampaignList(
                    key: ValueKey('events-$revision'),
                    repository: widget.repository,
                  )
                : ActivityFeed<Map<String, dynamic>>(
                    key: ValueKey('$kind-$revision'),
                    loadPage: (p) => widget.repository.page(kind, p),
                    id: (j) =>
                        (j[kind == 'notices'
                                ? 'announcementId'
                                : kind == 'tickets'
                                ? 'ticketId'
                                : 'id'])
                            .toString(),
                    header: Text(
                      kind == 'cases'
                          ? '운영자가 등록한 처리 현황입니다. 환불 금액은 주문 내역에서 별도로 확인하세요.'
                          : '아래로 당겨 최신 내용을 확인하세요.',
                    ),
                    emptyTitle: '등록된 내역이 없어요',
                    emptyDescription: kind == 'tickets'
                        ? '상품·배송에 대해 궁금한 점을 남겨주세요.'
                        : '새로운 안내가 있으면 여기에 표시됩니다.',
                    emptyIcon: Icons.inbox_outlined,
                    itemBuilder: (j) => Card(
                      child: Padding(
                        padding: const EdgeInsets.all(18),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            if (kind == 'cases')
                              Text(caseStates[j['status']] ?? j['status']),
                            Text(
                              j[kind == 'cases'
                                  ? 'summary'
                                  : kind == 'tickets'
                                  ? 'subject'
                                  : 'title'],
                              style: const TextStyle(
                                fontSize: 17,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                            if (j['body'] is String) ...[
                              const SizedBox(height: 8),
                              Text(j['body']),
                            ],
                            if (kind == 'cases')
                              SelectableText('주문번호 ${j['orderId']}'),
                            if (kind == 'tickets') ...[
                              Text(
                                {
                                      'OPEN': '답변 대기',
                                      'ANSWERED': '답변 도착',
                                      'CLOSED': '문의 종료',
                                    }[j['status']] ??
                                    j['status'],
                              ),
                              TextButton(
                                onPressed: () => Navigator.of(context).push(
                                  MaterialPageRoute(
                                    builder: (_) => SupportThreadPage(
                                      id: j['ticketId'],
                                      repository: widget.repository,
                                    ),
                                  ),
                                ),
                                child: const Text('대화·답변 확인'),
                              ),
                            ],
                            if (kind == 'inbox') ...[
                              Text('참조번호 ${j['targetId']}'),
                              if (j['readAt'] == null)
                                TextButton(
                                  onPressed: () async {
                                    try {
                                      await widget.repository.api.post(
                                        '/notifications/read',
                                        body: {'throughId': j['id']},
                                      );
                                      if (mounted) {
                                        setState(() => revision++);
                                      }
                                    } catch (e) {
                                      if (context.mounted) {
                                        ScaffoldMessenger.of(
                                          context,
                                        ).showSnackBar(
                                          SnackBar(content: Text(e.toString())),
                                        );
                                      }
                                    }
                                  },
                                  child: const Text('여기까지 읽음'),
                                ),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
          ),
        ],
      ),
    ),
  );
}

class CampaignList extends StatefulWidget {
  final CustomerContentRepository repository;
  const CampaignList({super.key, required this.repository});
  @override
  State<CampaignList> createState() => _CampaignListState();
}

class _CampaignListState extends State<CampaignList> {
  late Future<List<Campaign>> future = widget.repository.campaigns();
  @override
  Widget build(BuildContext context) => FutureBuilder<List<Campaign>>(
    future: future,
    builder: (context, s) {
      if (s.connectionState != ConnectionState.done) {
        return const Center(child: CircularProgressIndicator());
      }
      if (s.hasError) {
        return Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(s.error.toString()),
              TextButton(
                onPressed: () =>
                    setState(() => future = widget.repository.campaigns()),
                child: const Text('다시 불러오기'),
              ),
            ],
          ),
        );
      }
      return RefreshIndicator(
        onRefresh: () async {
          setState(() => future = widget.repository.campaigns());
          await future;
        },
        child: ListView(
          padding: const EdgeInsets.all(20),
          physics: const AlwaysScrollableScrollPhysics(),
          children: s.data!.isEmpty
              ? [const Text('현재 진행 중인 이벤트가 없어요.')]
              : s.data!.map((c) => CampaignCard(campaign: c)).toList(),
        ),
      );
    },
  );
}

class CampaignCard extends StatelessWidget {
  final Campaign campaign;
  final bool compact;
  const CampaignCard({super.key, required this.campaign, this.compact = false});
  @override
  Widget build(BuildContext context) => Card(
    clipBehavior: Clip.antiAlias,
    child: Padding(
      padding: const EdgeInsets.all(18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (campaign.imageUrl != null)
            Image.network(
              campaign.imageUrl!,
              height: compact ? 96 : 160,
              width: double.infinity,
              fit: BoxFit.cover,
              errorBuilder: (_, error, stack) => const SizedBox.shrink(),
            ),
          Text(
            campaign.title,
            maxLines: compact ? 2 : null,
            overflow: compact ? TextOverflow.ellipsis : null,
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 10),
          Text(
            campaign.body,
            maxLines: compact ? 2 : null,
            overflow: compact ? TextOverflow.ellipsis : null,
          ),
          const SizedBox(height: 10),
          Text(
            '${activityDateLabel(campaign.startsAt)} ~ ${activityDateLabel(campaign.endsAt)}',
          ),
          if (compact)
            TextButton(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const CustomerUpdatesPage()),
              ),
              child: const Text('이벤트 안내 전체 보기'),
            ),
          if (!compact && campaign.gachaId != null)
            TextButton(
              onPressed: () async {
                try {
                  final data = await const CapsuleBoxRepository().getById(
                    campaign.gachaId!,
                  );
                  if (!context.mounted) {
                    return;
                  }
                  await Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => GachaDetailPage(
                        box: CapsuleBox(
                          id: data.id,
                          name: data.title,
                          priceWon: data.price,
                          icon: Icons.inventory_2_outlined,
                          accentColor: Colors.deepOrange,
                        ),
                        onGoToWallet: () => Navigator.of(context).push(
                          MaterialPageRoute(
                            builder: (_) => WalletPage(
                              onGoToHome: () => Navigator.of(
                                context,
                              ).popUntil((r) => r.isFirst),
                            ),
                          ),
                        ),
                      ),
                    ),
                  );
                } catch (e) {
                  if (context.mounted) {
                    ScaffoldMessenger.of(
                      context,
                    ).showSnackBar(SnackBar(content: Text(e.toString())));
                  }
                }
              },
              child: const Text('연결 박스·확률 확인'),
            ),
        ],
      ),
    ),
  );
}

class SupportThreadPage extends StatefulWidget {
  final String id;
  final CustomerContentRepository repository;
  const SupportThreadPage({
    super.key,
    required this.id,
    this.repository = const CustomerContentRepository(),
  });
  @override
  State<SupportThreadPage> createState() => _SupportThreadPageState();
}

class _SupportThreadPageState extends State<SupportThreadPage> {
  final List<Map<String, dynamic>> messages = [];
  Map<String, dynamic>? ticket;
  bool loading = false, more = true;
  String? error;
  int after = 0;
  @override
  void initState() {
    super.initState();
    load(reset: true);
  }

  Future<void> load({bool reset = false}) async {
    if (loading) {
      return;
    }
    setState(() => loading = true);
    try {
      final r = await widget.repository.ticket(
        widget.id,
        after: reset ? 0 : after,
      );
      if (mounted) {
        setState(() {
          if (reset) {
            messages.clear();
          }
          messages.addAll((r['messages'] as List).cast<Map<String, dynamic>>());
          ticket = r['ticket'];
          after = r['nextAfter'];
          more = r['hasMore'];
          error = null;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() => error = e.toString());
      }
    } finally {
      if (mounted) {
        setState(() => loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('문의 대화'),
      actions: [
        IconButton(
          onPressed: loading ? null : () => load(reset: true),
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            ticket?['subject'] ?? '문의 확인 중',
            style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w700),
          ),
          SelectableText('문의번호 ${widget.id}'),
          if (ticket?['orderId'] != null)
            SelectableText('주문번호 ${ticket!['orderId']}'),
          for (final m in messages)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      m['authorRole'] == 'SUPPORT' ? '운영자' : '나',
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    const SizedBox(height: 8),
                    Text(m['body']),
                  ],
                ),
              ),
            ),
          if (error != null) Text(error!),
          if (loading) const Center(child: CircularProgressIndicator()),
          if (more)
            TextButton(
              onPressed: loading ? null : () => load(),
              child: const Text('메시지 더 보기'),
            ),
          if (ticket != null && ticket!['status'] != 'CLOSED')
            FilledButton(
              onPressed: () async {
                await Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => SupportComposePage(ticketId: widget.id),
                  ),
                );
                if (mounted) {
                  await load(reset: true);
                }
              },
              child: const Text('추가 메시지 보내기'),
            ),
        ],
      ),
    ),
  );
}

class SupportComposePage extends StatefulWidget {
  final String? ticketId;
  const SupportComposePage({super.key, this.ticketId});
  @override
  State<SupportComposePage> createState() => _SupportComposePageState();
}

class _SupportComposePageState extends State<SupportComposePage> {
  final subject = TextEditingController(),
      body = TextEditingController(),
      order = TextEditingController();
  String category = 'OTHER';
  SupportRepository? repository;
  Map<String, dynamic>? pending;
  bool busy = true;
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
      final r = SupportRepository(await OrderRepository.forUser(id));
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

  Future<void> send() async {
    if (busy || repository == null) {
      return;
    }
    setState(() => busy = true);
    try {
      final id = pending != null
          ? await repository!.recover()
          : await repository!.send(
              ticketId: widget.ticketId,
              body: widget.ticketId != null
                  ? {'body': body.text.trim()}
                  : {
                      'subject': subject.text.trim(),
                      'body': body.text.trim(),
                      'category': category,
                      if (order.text.trim().isNotEmpty)
                        'orderId': order.text.trim(),
                    },
            );
      if (!mounted) {
        return;
      }
      if (id != null) {
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => SupportThreadPage(id: id)),
        );
      } else {
        setState(() => pending = null);
      }
    } catch (e) {
      try {
        final p = await repository!.pending();
        if (mounted) {
          setState(() {
            error = e.toString();
            pending = p;
          });
        }
      } catch (_) {
        if (mounted) {
          setState(() {
            error = '전송 복구 기록을 읽지 못했습니다. 다시 열어 확인해주세요.';
            repository = null;
          });
        }
      }
    } finally {
      if (mounted) {
        setState(() => busy = false);
      }
    }
  }

  @override
  void dispose() {
    subject.dispose();
    body.dispose();
    order.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text(widget.ticketId == null ? '문의 작성' : '추가 메시지')),
    body: SafeArea(
      child: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (pending != null)
            const Text('이전 전송의 결과를 확인해야 합니다. 같은 요청번호로 조회하며 문의를 중복 접수하지 않습니다.')
          else ...[
            if (widget.ticketId == null) ...[
              DropdownButtonFormField<String>(
                initialValue: category,
                items:
                    const {
                          'OTHER': '기타',
                          'SHIPPING': '배송',
                          'PAYMENT': '결제',
                          'REFUND': '환불',
                          'ACCOUNT': '계정',
                        }.entries
                        .map(
                          (e) => DropdownMenuItem(
                            value: e.key,
                            child: Text(e.value),
                          ),
                        )
                        .toList(),
                onChanged: busy ? null : (v) => setState(() => category = v!),
              ),
              TextField(
                controller: subject,
                maxLength: 100,
                enabled: !busy,
                decoration: const InputDecoration(labelText: '문의 제목'),
              ),
              TextField(
                controller: order,
                enabled: !busy,
                decoration: const InputDecoration(
                  labelText: '주문번호 (선택)',
                  helperText: '구매 내역의 주문번호를 붙여넣으면 주문과 연결됩니다.',
                ),
              ),
            ],
            TextField(
              controller: body,
              maxLines: 8,
              maxLength: 4000,
              enabled: !busy,
              decoration: const InputDecoration(
                labelText: '문의 내용',
                helperText: '카드번호·비밀번호 등 결제 인증정보는 쓰지 마세요.',
              ),
            ),
          ],
          if (error != null) Text(error!),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: busy || repository == null ? null : send,
            child: Text(
              busy
                  ? '확인 중'
                  : pending != null
                  ? '이전 전송 결과 확인'
                  : '문의 보내기',
            ),
          ),
        ],
      ),
    ),
  );
}

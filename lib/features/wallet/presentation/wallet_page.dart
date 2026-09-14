import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../domain/point_history.dart';
import 'point_history_page.dart';

/// GP is a reward/conversion balance, never a purchasable currency.
class WalletPage extends StatefulWidget {
  final VoidCallback onGoToHome;
  final PointHistoryRepository repository;

  const WalletPage({
    super.key,
    required this.onGoToHome,
    this.repository = const PointHistoryRepository(),
  });

  @override
  State<WalletPage> createState() => _WalletPageState();
}

class _WalletPageState extends State<WalletPage> {
  List<PointHistoryEntry> _history = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _load());
  }

  Future<void> _load() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    final auth = context.read<AuthProvider>();
    try {
      final history = await widget.repository.getAll(limit: 5);
      await auth.refreshProfile();
      if (!mounted) return;
      setState(() => _history = history);
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = 'GP 내역을 불러오지 못했습니다');
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _openHistory() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => const PointHistoryPage()));
  }

  @override
  Widget build(BuildContext context) {
    final gp = context.watch<GpProvider>();
    return Scaffold(
      appBar: AppBar(
        title: const Text('나의 GP'),
        automaticallyImplyLeading: false,
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          children: [
            Container(
              padding: const EdgeInsets.all(24),
              decoration: BoxDecoration(
                gradient: AppColors.heroGradient,
                borderRadius: BorderRadius.circular(26),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('보유 GP', style: TextStyle(color: Colors.white)),
                  const SizedBox(height: 8),
                  Text(
                    '${gp.formattedBalance} GP',
                    style: const TextStyle(
                      color: Colors.white,
                      fontSize: 32,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    '상품 전환과 이벤트로 받은 포인트예요.',
                    style: TextStyle(color: Colors.white),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            const Text(
              'GP 이용 안내',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            const Text(
              '1 GP = 1원 기준으로 사용할 수 있어요.\n'
              'GP는 별도로 충전하거나 현금으로 환불할 수 없어요.\n'
              'GP의 유효기간은 없어요.',
            ),
            const SizedBox(height: 20),
            Row(
              children: [
                const Expanded(
                  child: Text(
                    '최근 GP 내역',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                ),
                TextButton(onPressed: _openHistory, child: const Text('전체보기')),
              ],
            ),
            if (_loading)
              const Center(child: CircularProgressIndicator())
            else if (_error != null) ...[
              Text(_error!),
              TextButton(onPressed: _load, child: const Text('다시 시도')),
            ] else if (_history.isEmpty)
              const Padding(
                padding: EdgeInsets.all(24),
                child: Text('아직 GP 내역이 없어요'),
              )
            else
              ..._history.map(
                (entry) => ListTile(
                  contentPadding: EdgeInsets.zero,
                  title: Text(entry.description),
                  subtitle: Text(entry.formattedDate),
                  trailing: Text(
                    entry.formattedAmount,
                    style: TextStyle(color: entry.type.amountColor),
                  ),
                ),
              ),
            const SizedBox(height: 24),
            OutlinedButton(
              onPressed: widget.onGoToHome,
              child: const Text('캡슐 둘러보기'),
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import '../../../shared/providers/gp_provider.dart';
import '../../gacha/presentation/gacha_detail_page.dart';
import '../data/capsule_box_repository.dart';
import '../domain/capsule_box.dart';
import 'widgets/capsule_box_card.dart';

class HomePage extends StatefulWidget {
  final VoidCallback onGoToWallet;
  final Future<List<CapsuleBox>> Function()? loadCatalog;
  const HomePage({super.key, required this.onGoToWallet, this.loadCatalog});
  @override
  State<HomePage> createState() => _HomePageState();
}
class _HomePageState extends State<HomePage> {
  List<CapsuleBox> _boxes = [];
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _load();
  }
  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final boxes = await (widget.loadCatalog?.call() ?? const CapsuleBoxRepository().getAll());
      if (mounted) setState(() { _boxes = boxes; _loading = false; });
    } catch (error) {
      if (mounted) setState(() {
        _loading = false;
        _error = error is ApiException ? error.message : '박스를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
      });
    }
  }
  Future<void> _open(CapsuleBox box) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) =>
      GachaDetailPage(box: box, onGoToWallet: widget.onGoToWallet)));
    if (mounted) {
      await context.read<AuthProvider>().refreshProfile();
      if (mounted) await _load();
    }
  }
  @override
  Widget build(BuildContext context) => CatalogScreen(
    boxes: _boxes, loading: _loading, error: _error,
    balance: context.watch<GpProvider>().formattedBalance,
    onRefresh: _load, onOpen: _open, onWallet: widget.onGoToWallet,
  );
}

/// Presentation shared by the real home and deterministic visual checks.
class CatalogScreen extends StatefulWidget {
  final List<CapsuleBox> boxes;
  final bool loading;
  final String? error;
  final String balance;
  final Future<void> Function() onRefresh;
  final ValueChanged<CapsuleBox> onOpen;
  final VoidCallback onWallet;
  const CatalogScreen({super.key, required this.boxes, this.loading = false,
    this.error, required this.balance, required this.onRefresh, required this.onOpen, required this.onWallet});
  @override
  State<CatalogScreen> createState() => _CatalogScreenState();
}
class _CatalogScreenState extends State<CatalogScreen> {
  final _search = TextEditingController();
  String _sort = '기본순';
  @override
  void dispose() { _search.dispose(); super.dispose(); }
  List<CapsuleBox> get _visible {
    final query = _search.text.trim().toLowerCase();
    final result = widget.boxes.where((b) => b.name.toLowerCase().contains(query)).toList();
    if (_sort == '낮은 가격순') result.sort((a,b) => a.priceWon.compareTo(b.priceWon));
    if (_sort == '높은 가격순') result.sort((a,b) => b.priceWon.compareTo(a.priceWon));
    return result;
  }
  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    return Scaffold(
      appBar: AppBar(automaticallyImplyLeading: false, titleSpacing: 20,
        title: const Text('가치가차', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w900, letterSpacing: -1)),
        actions: [IconButton(tooltip: 'GP 내역', onPressed: widget.onWallet,
          icon: const Icon(Icons.account_balance_wallet_outlined)), const SizedBox(width: 8)]),
      body: SafeArea(top: false, child: RefreshIndicator(
        onRefresh: widget.onRefresh,
        child: CustomScrollView(physics: const AlwaysScrollableScrollPhysics(),
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          slivers: [
            SliverPadding(padding: const EdgeInsets.fromLTRB(20, 8, 20, 0), sliver: SliverToBoxAdapter(
              child: Row(children: [
                const Expanded(child: Text('취향을 발견하는 즐거움', style: TextStyle(color: AppColors.textSecondary, fontSize: 13))),
                TextButton(onPressed: widget.onWallet, child: Text('${widget.balance} GP', style: const TextStyle(fontWeight: FontWeight.w800))),
              ]),
            )),
            if (!widget.loading && widget.error == null && widget.boxes.isNotEmpty)
              SliverPadding(padding: const EdgeInsets.fromLTRB(20, 12, 20, 24), sliver: SliverToBoxAdapter(
                child: _FeaturedBox(box: widget.boxes.first, onTap: () => widget.onOpen(widget.boxes.first)))),
            SliverPadding(padding: const EdgeInsets.fromLTRB(20, 12, 20, 0), sliver: SliverToBoxAdapter(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                const Text('어떤 발견을 해볼까요?', style: TextStyle(fontSize: 23, fontWeight: FontWeight.w800, letterSpacing: -.8)),
                const SizedBox(height: 16),
                TextField(controller: _search, onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(hintText: '박스 이름으로 검색', prefixIcon: const Icon(Icons.search_rounded),
                    suffixIcon: _search.text.isEmpty ? null : IconButton(tooltip: '검색어 지우기',
                      icon: const Icon(Icons.close_rounded), onPressed: () => setState(_search.clear)))),
                const SizedBox(height: 16),
                Wrap(spacing: 8, runSpacing: 8, children: ['기본순', '낮은 가격순', '높은 가격순'].map((label) =>
                  ChoiceChip(label: Text(label), selected: _sort == label, showCheckmark: false,
                    onSelected: (_) => setState(() => _sort = label))).toList()),
                const SizedBox(height: 22),
                Text(widget.loading ? '박스를 불러오고 있어요' : '박스 ${visible.length}개',
                  style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 13)),
                const SizedBox(height: 14),
              ]),
            )),
            SliverPadding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 32), sliver: SliverToBoxAdapter(
              child: widget.loading ? const Padding(padding: EdgeInsets.all(48), child: Center(child: CircularProgressIndicator()))
                : widget.error != null ? _CatalogState(icon: Icons.wifi_off_rounded, title: '연결을 확인해주세요',
                    message: widget.error!, action: TextButton(onPressed: widget.onRefresh, child: const Text('다시 불러오기')))
                : visible.isEmpty ? _CatalogState(icon: Icons.search_off_rounded,
                    title: _search.text.isEmpty ? '새로운 박스를 준비하고 있어요' : '검색 결과가 없어요',
                    message: _search.text.isEmpty ? '잠시 후 다시 방문해주세요.' : '다른 이름으로 검색해보세요.',
                    action: _search.text.isEmpty ? null : TextButton(onPressed: () => setState(_search.clear), child: const Text('전체 보기')))
                : LayoutBuilder(builder: (context, constraints) {
                    final scale = MediaQuery.textScalerOf(context).scale(14) / 14;
                    final columns = constraints.maxWidth < 320 || scale > 1.4 ? 1 : constraints.maxWidth > 700 ? 3 : 2;
                    final width = (constraints.maxWidth - (columns - 1) * 14) / columns;
                    return Wrap(spacing: 14, runSpacing: 16, children: visible.map((box) =>
                      SizedBox(width: width, child: CapsuleBoxCard(box: box, onTap: () => widget.onOpen(box)))).toList());
                  }),
            )),
          ],
        ),
      )),
    );
  }
}
class _FeaturedBox extends StatelessWidget {
  final CapsuleBox box;
  final VoidCallback onTap;
  const _FeaturedBox({required this.box, required this.onTap});
  @override
  Widget build(BuildContext context) => Material(color: AppColors.heroDeep,
    borderRadius: BorderRadius.circular(26), clipBehavior: Clip.antiAlias,
    child: InkWell(onTap: onTap, child: Padding(padding: const EdgeInsets.all(22),
      child: Row(children: [
        Expanded(flex: 3, child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('DISCOVER', style: TextStyle(color: Color(0xFFFFB49C), fontSize: 10, letterSpacing: 2, fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          Text(box.name, maxLines: 3, overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800, height: 1.25, letterSpacing: -.5)),
          const SizedBox(height: 18),
          Text(box.formattedPrice, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          const Text('구성 상품 살펴보기 →', style: TextStyle(color: Color(0xFFDAD8DF), fontSize: 12)),
        ])),
        const SizedBox(width: 16),
        Expanded(flex: 2, child: ClipRRect(borderRadius: BorderRadius.circular(18),
          child: AspectRatio(aspectRatio: .83, child: CatalogArtwork(box: box)))),
      ]),
    )),
  );
}
class _CatalogState extends StatelessWidget {
  final IconData icon;
  final String title, message;
  final Widget? action;
  const _CatalogState({required this.icon, required this.title, required this.message, this.action});
  @override
  Widget build(BuildContext context) => Padding(padding: const EdgeInsets.symmetric(vertical: 38),
    child: Column(children: [
      Icon(icon, size: 36, color: AppColors.textSecondary), const SizedBox(height: 16),
      Text(title, textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 17)),
      const SizedBox(height: 8), Text(message, textAlign: TextAlign.center, style: const TextStyle(color: AppColors.textSecondary, height: 1.5)),
      if (action != null) ...[const SizedBox(height: 12), action!],
    ]),
  );
}

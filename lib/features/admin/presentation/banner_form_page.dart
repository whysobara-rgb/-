import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../core/network/api_client.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../core/utils/format.dart';
import '../../../shared/widgets/ui.dart';
import '../data/admin_repository.dart';
import '../domain/admin_forms.dart';
import '../domain/admin_models.dart';
import 'admin_widgets.dart';

/// 배너 만들기·고치기. 저장하면 true로 닫힌다.
class BannerFormPage extends StatefulWidget {
  final AdminRepository repository;
  final AdminBanner? banner;

  const BannerFormPage({super.key, required this.repository, this.banner});

  static Route<bool> route({
    required AdminRepository repository,
    AdminBanner? banner,
  }) => MaterialPageRoute<bool>(
    settings: const RouteSettings(name: '/admin/banner'),
    builder: (_) => BannerFormPage(repository: repository, banner: banner),
  );

  @override
  State<BannerFormPage> createState() => _BannerFormPageState();
}

class _BannerFormPageState extends State<BannerFormPage> {
  late final BannerForm _form = widget.banner == null
      ? BannerForm()
      : BannerForm.from(widget.banner!);
  late final _title = TextEditingController(text: _form.title);
  late final _subtitle = TextEditingController(text: _form.subtitle);
  late final _badge = TextEditingController(text: _form.badge);
  late final _hex = TextEditingController(text: _form.accentColorHex);
  late final _url = TextEditingController(
    text: _form.linkType == AdminLinkType.url ? _form.linkTarget : '',
  );
  late final _priority = TextEditingController(text: _form.priority);

  List<AdminGacha>? _boxes;
  Map<String, String> _errors = const {};
  String? _serverError;
  bool _saving = false;

  bool get _editing => widget.banner != null;

  @override
  void initState() {
    super.initState();
    widget.repository.gachas().then(
      (boxes) {
        if (mounted) setState(() => _boxes = boxes);
      },
      onError: (Object _) {
        if (mounted) setState(() => _boxes = const []);
      },
    );
  }

  @override
  void dispose() {
    for (final c in [_title, _subtitle, _badge, _hex, _url, _priority]) {
      c.dispose();
    }
    super.dispose();
  }

  void _sync() {
    _form
      ..title = _title.text
      ..subtitle = _subtitle.text
      ..badge = _badge.text
      ..accentColorHex = _hex.text
      ..priority = _priority.text;
    if (_form.linkType == AdminLinkType.url) _form.linkTarget = _url.text;
  }

  Future<void> _save() async {
    _sync();
    final boxes = _boxes;
    final errors = _form.validate(
      boxIds: boxes == null || boxes.isEmpty
          ? null
          : boxes.map((b) => b.id).toSet(),
    );
    setState(() {
      _errors = errors;
      _serverError = null;
    });
    if (errors.isNotEmpty) return;
    setState(() => _saving = true);
    try {
      if (_editing) {
        await widget.repository.updateBanner(widget.banner!.id, _form.toJson());
      } else {
        await widget.repository.createBanner(_form);
      }
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _serverError = e.displayMessage;
        });
      }
    }
  }

  Future<void> _pickTime({required bool start}) async {
    final initial =
        (start ? _form.startsAt : _form.endsAt)?.toLocal() ?? DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: DateTime(2024),
      lastDate: DateTime(2030),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(initial),
    );
    if (time == null) return;
    final picked = DateTime(
      date.year,
      date.month,
      date.day,
      time.hour,
      time.minute,
    );
    setState(() {
      if (start) {
        _form.startsAt = picked;
      } else {
        _form.endsAt = picked;
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 0,
        title: Text(_editing ? '배너 #${widget.banner!.id} 수정' : '새 배너'),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          Space.x2,
          Space.gutter,
          Space.x10,
        ),
        children: [
          _Preview(
            title: _title.text,
            subtitle: _subtitle.text,
            badge: _badge.text,
            hex: _hex.text,
          ),
          if (_serverError != null) ...[
            const SizedBox(height: Space.x3),
            InlineError(_serverError!),
          ],
          const SizedBox(height: Space.x4),
          _field(_title, '제목 *', error: _errors['title'], maxLength: 100),
          _field(_subtitle, '부제', error: _errors['subtitle'], maxLength: 200),
          _field(
            _badge,
            '배지',
            hint: '예: OPEN 기념',
            error: _errors['badge'],
            maxLength: 30,
          ),
          _field(
            _hex,
            '강조색',
            hint: '#2FE0A2',
            error: _errors['accentColorHex'],
            prefix: _Swatch(hex: _hex.text),
          ),
          const SizedBox(height: Space.x2),
          Text('연결', style: AppText.bodyStrong),
          const SizedBox(height: Space.x2),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: [
              for (final t in AdminLinkType.values)
                AdminChip(
                  label: t.label,
                  selected: _form.linkType == t,
                  onTap: () => setState(() {
                    _sync();
                    _form.linkType = t;
                    _form.linkTarget = t == AdminLinkType.url ? _url.text : '';
                  }),
                ),
            ],
          ),
          const SizedBox(height: Space.x3),
          ..._targetField(),
          _field(
            _priority,
            '우선순위',
            hint: '작을수록 앞',
            error: _errors['priority'],
            keyboard: const TextInputType.numberWithOptions(signed: true),
            formatters: [FilteringTextInputFormatter.allow(RegExp(r'[-0-9]'))],
          ),
          const SizedBox(height: Space.x2),
          Text('노출 기간', style: AppText.bodyStrong),
          const SizedBox(height: Space.x2),
          _TimeRow(
            label: '시작',
            value: _form.startsAt,
            emptyLabel: '바로 시작',
            onPick: () => _pickTime(start: true),
            onClear: () => setState(() => _form.startsAt = null),
          ),
          const SizedBox(height: 6),
          _TimeRow(
            label: '종료',
            value: _form.endsAt,
            emptyLabel: '종료 없음',
            onPick: () => _pickTime(start: false),
            onClear: () => setState(() => _form.endsAt = null),
          ),
          if (_errors['endsAt'] != null) ...[
            const SizedBox(height: 6),
            Text(
              _errors['endsAt']!,
              style: AppText.caption.copyWith(color: AppColors.danger),
            ),
          ],
          const SizedBox(height: Space.x3),
          Row(
            children: [
              Expanded(child: Text('노출 켜기', style: AppText.bodyStrong)),
              Switch(
                value: _form.active,
                onChanged: (v) => setState(() => _form.active = v),
                activeTrackColor: AppColors.brand,
                activeThumbColor: AppColors.onBrand,
              ),
            ],
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x2,
            Space.gutter,
            Space.x3,
          ),
          child: PrimaryButton(
            label: _editing ? '저장' : '만들기',
            loading: _saving,
            onPressed: _save,
          ),
        ),
      ),
    );
  }

  List<Widget> _targetField() {
    switch (_form.linkType) {
      case AdminLinkType.gacha:
      case AdminLinkType.odds:
        final boxes = _boxes;
        final current = int.tryParse(_form.linkTarget);
        return [
          if (boxes == null)
            const LoadingView(height: 56)
          else
            DropdownButtonFormField<int?>(
              initialValue: boxes.any((b) => b.id == current) ? current : null,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: _form.linkType == AdminLinkType.gacha
                    ? '연결할 박스 *'
                    : '박스(비우면 확률 공시 목록)',
                errorText: _errors['linkTarget'],
              ),
              items: [
                if (_form.linkType == AdminLinkType.odds)
                  const DropdownMenuItem(value: null, child: Text('확률 공시 목록')),
                for (final b in boxes)
                  DropdownMenuItem(
                    value: b.id,
                    child: Text(
                      '#${b.id} ${b.title}${b.active ? '' : ' (판매 중지)'}',
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
              ],
              onChanged: (v) =>
                  setState(() => _form.linkTarget = v == null ? '' : '$v'),
            ),
          const SizedBox(height: Space.x3),
        ];
      case AdminLinkType.url:
        return [
          _field(
            _url,
            '웹 주소 *',
            hint: 'https://',
            error: _errors['linkTarget'],
            keyboard: TextInputType.url,
          ),
        ];
      case AdminLinkType.none:
      case AdminLinkType.attendance:
      case AdminLinkType.topup:
        return [
          Text(switch (_form.linkType) {
            AdminLinkType.attendance => '누르면 홈의 출석체크로 가요.',
            AdminLinkType.topup => '누르면 충전 화면이 열려요.',
            _ => '누르지 않는 안내용 배너예요.',
          }, style: AppText.caption),
          const SizedBox(height: Space.x3),
        ];
    }
  }

  Widget _field(
    TextEditingController controller,
    String label, {
    String? hint,
    String? error,
    int? maxLength,
    Widget? prefix,
    TextInputType? keyboard,
    List<TextInputFormatter>? formatters,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: Space.x3),
      child: TextField(
        controller: controller,
        maxLength: maxLength,
        keyboardType: keyboard,
        inputFormatters: formatters,
        style: AppText.body,
        onChanged: (_) => setState(() {}),
        decoration: InputDecoration(
          labelText: label,
          hintText: hint,
          errorText: error,
          counterText: '',
          prefixIcon: prefix,
        ),
      ),
    );
  }
}

class _Swatch extends StatelessWidget {
  final String hex;
  const _Swatch({required this.hex});

  @override
  Widget build(BuildContext context) {
    final argb = parseHexArgb(hex);
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Container(
        width: 18,
        height: 18,
        decoration: BoxDecoration(
          color: argb == null ? null : Color(argb),
          borderRadius: Radii.chip,
          border: Border.all(color: AppColors.hairlineStrong),
        ),
      ),
    );
  }
}

/// 홈 배너 느낌을 대략 보여주는 미리보기(실제 홈 배너와 같지는 않다).
class _Preview extends StatelessWidget {
  final String title;
  final String subtitle;
  final String badge;
  final String hex;
  const _Preview({
    required this.title,
    required this.subtitle,
    required this.badge,
    required this.hex,
  });

  @override
  Widget build(BuildContext context) {
    final argb = parseHexArgb(hex);
    final accent = argb == null ? AppColors.brand : Color(argb);
    return Container(
      height: 112,
      padding: const EdgeInsets.all(Space.x4),
      decoration: BoxDecoration(
        borderRadius: Radii.card,
        border: Border.all(color: accent.withValues(alpha: 0.5)),
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [accent.withValues(alpha: 0.28), AppColors.surface],
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          if (badge.trim().isNotEmpty) ...[
            StatusTag(badge.trim(), color: accent),
            const SizedBox(height: 6),
          ],
          Text(
            title.trim().isEmpty ? '제목' : title.trim(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.title2,
          ),
          if (subtitle.trim().isNotEmpty)
            Text(
              subtitle.trim(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: AppText.caption,
            ),
        ],
      ),
    );
  }
}

class _TimeRow extends StatelessWidget {
  final String label;
  final DateTime? value;
  final String emptyLabel;
  final VoidCallback onPick;
  final VoidCallback onClear;

  const _TimeRow({
    required this.label,
    required this.value,
    required this.emptyLabel,
    required this.onPick,
    required this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    final v = value;
    return Row(
      children: [
        SizedBox(width: 40, child: Text(label, style: AppText.callout)),
        Expanded(
          child: OutlinedButton(
            onPressed: onPick,
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 40),
              alignment: Alignment.centerLeft,
            ),
            child: Text(
              v == null ? emptyLabel : formatDateTime(v),
              style: AppText.num(AppText.body).copyWith(
                color: v == null ? AppColors.textTertiary : AppColors.text,
              ),
            ),
          ),
        ),
        if (v != null)
          IconButton(
            tooltip: '$label 지우기',
            onPressed: onClear,
            icon: const Icon(Icons.close, size: 18),
          ),
      ],
    );
  }
}

import 'package:flutter/material.dart';
import '../../../../core/theme/app_spacing.dart';
import '../../../../core/theme/app_typography.dart';
import '../../../../shared/widgets/ui.dart';
import '../../domain/agreements.dart';
import '../../social/social_auth_client.dart';
import 'agreement_panel.dart';
import '../../../../core/utils/format.dart';

/// 소셜 최초 가입 시트에서 받은 값.
class SocialConsent {
  final Agreements agreements;

  /// 비워 두면 null → 서버가 제공자 프로필 이름을 쓴다.
  final String? nickname;

  const SocialConsent({required this.agreements, this.nickname});
}

/// 서버가 10010(약관 동의 필요)을 돌려줬을 때 여는 시트.
/// 닫으면 null, 동의하면 [SocialConsent].
Future<SocialConsent?> showSocialConsentSheet(
  BuildContext context, {
  required SocialProvider provider,
  String? suggestedNickname,
}) {
  return showAppSheet<SocialConsent>(
    context: context,
    title: '${provider.label}로 가입하기',
    builder: (_) => SocialConsentSheet(
      provider: provider,
      suggestedNickname: suggestedNickname,
    ),
  );
}

class SocialConsentSheet extends StatefulWidget {
  final SocialProvider provider;
  final String? suggestedNickname;

  const SocialConsentSheet({
    super.key,
    required this.provider,
    this.suggestedNickname,
  });

  @override
  State<SocialConsentSheet> createState() => _SocialConsentSheetState();
}

class _SocialConsentSheetState extends State<SocialConsentSheet> {
  late final TextEditingController _nickname = TextEditingController(
    text: widget.suggestedNickname ?? '',
  );
  Agreements _agreements = const Agreements();
  String? _nicknameError;

  @override
  void dispose() {
    _nickname.dispose();
    super.dispose();
  }

  void _submit() {
    final nickname = _nickname.text.trim();
    if (nickname.isNotEmpty && (nickname.length < 2 || nickname.length > 20)) {
      setState(() => _nicknameError = '닉네임은 2~20자로 정해 주세요');
      return;
    }
    Navigator.of(context).pop(
      SocialConsent(
        agreements: _agreements,
        nickname: nickname.isEmpty ? null : nickname,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final label = widget.provider.label;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(
        Space.gutter,
        0,
        Space.gutter,
        Space.x4,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            keepAll(
              '$label 계정으로 처음 오셨어요. 약관에 동의하면 가치가차 계정이 '
              '만들어지고 축하 GP가 들어와요.',
            ),
            style: AppText.callout,
          ),
          const SizedBox(height: Space.x5),
          Text(
            '닉네임 (선택)',
            style: AppText.caption.copyWith(
              color: Theme.of(context).colorScheme.onSurface,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _nickname,
            maxLength: 20,
            style: AppText.body,
            onChanged: (_) {
              if (_nicknameError != null) setState(() => _nicknameError = null);
            },
            decoration: InputDecoration(
              hintText: '비워 두면 $label 프로필 이름을 써요',
              counterText: '',
              errorText: _nicknameError,
            ),
          ),
          const SizedBox(height: Space.x5),
          AgreementPanel(
            value: _agreements,
            onChanged: (v) => setState(() => _agreements = v),
          ),
          const SizedBox(height: Space.x2),
          Text(
            _agreements.allRequired
                ? '마케팅 수신 동의는 나중에 MY에서 바꿀 수 있어요.'
                : '필수 항목에 모두 동의해야 가입할 수 있어요.',
            style: AppText.caption,
          ),
          const SizedBox(height: Space.x5),
          PrimaryButton(
            label: '동의하고 시작하기',
            onPressed: _agreements.allRequired ? _submit : null,
          ),
        ],
      ),
    );
  }
}

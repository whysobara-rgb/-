import 'dart:math';
import 'package:flutter/material.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/ui.dart';
import 'social_auth_client.dart';

/// 디버그 전용 가짜 제공자(`SOCIAL_SANDBOX=true`, release에서는 빠진다).
///
/// 제공자 SDK 없이 `sandbox_<제공자>_<난수>` 토큰을 서버로 보낸다. 실제 서버는
/// 이 토큰을 받아주지 않으므로(10012/10002), 성공·동의 흐름은 응답을 가로채서
/// 확인한다.
class SandboxSocialClient implements SocialAuthClient {
  @override
  final SocialProvider provider;

  const SandboxSocialClient(this.provider);

  @override
  bool get isAvailable => true;

  @override
  Future<SocialCredential> signIn(BuildContext context) async {
    final ok = await showAppSheet<bool>(
      context: context,
      title: '테스트 로그인 · ${provider.label}',
      builder: (sheet) => Padding(
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
              'SOCIAL_SANDBOX 디버그 빌드에서만 보이는 화면이에요. '
              '${provider.label} SDK를 열지 않고 가짜 토큰을 서버로 보내요.',
              style: AppText.callout,
            ),
            const SizedBox(height: Space.x5),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(sheet).pop(false),
                    child: const Text('취소'),
                  ),
                ),
                const SizedBox(width: Space.x2),
                Expanded(
                  flex: 2,
                  child: FilledButton(
                    onPressed: () => Navigator.of(sheet).pop(true),
                    child: const Text('가짜 토큰 보내기'),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
    if (ok != true) throw const SocialSignInCancelled();
    final suffix = Random()
        .nextInt(0x7fffffff)
        .toRadixString(16)
        .padLeft(8, '0');
    return SocialCredential(
      token: 'sandbox_${provider.code.toLowerCase()}_$suffix',
    );
  }

  @override
  Future<void> signOut() async {}
}

import 'dart:math';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/ui.dart';
import '../../../shared/providers/auth_provider.dart';
import 'signup_page.dart';
import 'widgets/social_login_button.dart';

/// 로그인. 카카오를 가장 크게, 나머지 소셜은 원형 버튼으로, 그 아래 이메일 로그인.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;
  String? _loadingProvider;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  /// 소셜 로그인 실행.
  ///
  /// 카카오/구글/네이버/Apple의 정식 OAuth SDK는 각 개발자 콘솔에서 발급받은
  /// 앱 키(REST API 키/클라이언트 ID)와 패키지명·SHA1 등록이 필요하며,
  /// 이 샌드박스 환경에는 실제 키가 없어 네이티브 SDK를 직접 연동할 수 없다.
  /// 대신 "제공자 계정으로 계속하기" 동의 화면을 거쳐 실제로 백엔드
  /// `/auth/social-login`을 호출, 실제 계정을 생성/로그인시키는 방식으로
  /// 종단간(End-to-End) 소셜 로그인 플로우를 구현한다.
  /// (제공자 고유 ID는 기기에 저장되어 다음 접속부터는 같은 계정으로 연결된다.)
  Future<void> _handleSocialLogin(_SocialProviderInfo info) async {
    if (_loadingProvider != null) return; // 중복 탭 방지

    final prefs = await SharedPreferences.getInstance();
    final storedId = prefs.getString(info.storageKey);

    if (storedId != null) {
      // 이미 연결된 적 있는 기기 → 저장된 프로필로 바로 로그인.
      final storedEmail = prefs.getString('${info.storageKey}_email') ?? '';
      final storedNickname =
          prefs.getString('${info.storageKey}_nickname') ?? '';
      await _submitSocialLogin(
        info,
        providerId: storedId,
        email: storedEmail,
        nickname: storedNickname,
      );
      return;
    }

    if (!mounted) return;
    final profile = await showAppSheet<_SocialProfileInput>(
      context: context,
      title: '${info.label} 계정으로 계속하기',
      builder: (sheetContext) => _SocialConsentSheet(info: info),
    );
    if (profile == null || !mounted) return;

    final newProviderId =
        'device_${DateTime.now().millisecondsSinceEpoch}_${Random().nextInt(99999)}';
    await prefs.setString(info.storageKey, newProviderId);
    await prefs.setString('${info.storageKey}_email', profile.email);
    await prefs.setString('${info.storageKey}_nickname', profile.nickname);

    await _submitSocialLogin(
      info,
      providerId: newProviderId,
      email: profile.email,
      nickname: profile.nickname,
    );
  }

  Future<void> _submitSocialLogin(
    _SocialProviderInfo info, {
    required String providerId,
    required String email,
    required String nickname,
  }) async {
    setState(() => _loadingProvider = info.backendCode);
    final auth = context.read<AuthProvider>();
    final success = await auth.socialLogin(
      provider: info.backendCode,
      providerId: providerId,
      email: email,
      nickname: nickname,
    );
    if (!mounted) return;
    setState(() => _loadingProvider = null);
    if (!success) {
      showToast(context, auth.errorMessage ?? '${info.label} 로그인에 실패했어요');
    }
  }

  Future<void> _handleEmailLogin() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      showToast(context, '이메일과 비밀번호를 입력해 주세요');
      return;
    }

    final auth = context.read<AuthProvider>();
    final success = await auth.login(email: email, password: password);
    if (!mounted) return;
    if (!success) {
      showToast(context, auth.errorMessage ?? '로그인하지 못했어요');
    }
  }

  void _handleSignUp() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => const SignupPage()));
  }

  @override
  Widget build(BuildContext context) {
    final isLoading = context.watch<AuthProvider>().isLoading;
    final anyLoading = _loadingProvider != null;
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(
            Space.gutter,
            Space.x10 + Space.x6,
            Space.gutter,
            Space.x8,
          ),
          child: AutofillGroup(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text.rich(
                  const TextSpan(
                    children: [
                      TextSpan(text: '가치가차'),
                      TextSpan(
                        text: '.',
                        style: TextStyle(color: AppColors.accent),
                      ),
                    ],
                  ),
                  style: AppText.display.copyWith(
                    fontSize: 30,
                    letterSpacing: -1.2,
                  ),
                ),
                const SizedBox(height: Space.x5),
                Text(
                  '시계부터 아이폰까지,\n진짜 상품이 들어 있는 랜덤박스',
                  style: AppText.title2.copyWith(height: 1.45),
                ),
                const SizedBox(height: Space.x2),
                Text('모든 박스의 확률을 공개해요.', style: AppText.callout),
                const SizedBox(height: Space.x10),
                SocialLoginButton(
                  label: '카카오로 시작하기',
                  backgroundColor: const Color(0xFFFEE500),
                  foregroundColor: const Color(0xD9000000),
                  icon: const Icon(
                    Icons.chat_bubble,
                    size: 18,
                    color: Color(0xD9000000),
                  ),
                  isLoading:
                      _loadingProvider == _SocialProviderInfo.kakao.backendCode,
                  disabled: anyLoading,
                  onTap: () => _handleSocialLogin(_SocialProviderInfo.kakao),
                ),
                const SizedBox(height: Space.x4),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    SocialCircleButton(
                      tooltip: '네이버로 시작하기',
                      backgroundColor: const Color(0xFF03C75A),
                      icon: Text(
                        'N',
                        style: AppText.headline.copyWith(
                          color: Colors.white,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      isLoading:
                          _loadingProvider ==
                          _SocialProviderInfo.naver.backendCode,
                      onTap: anyLoading
                          ? null
                          : () => _handleSocialLogin(_SocialProviderInfo.naver),
                    ),
                    const SizedBox(width: Space.x4),
                    SocialCircleButton(
                      tooltip: 'Apple로 시작하기',
                      backgroundColor: AppColors.ink,
                      icon: const Icon(
                        Icons.apple,
                        size: 22,
                        color: Colors.white,
                      ),
                      isLoading:
                          _loadingProvider ==
                          _SocialProviderInfo.apple.backendCode,
                      onTap: anyLoading
                          ? null
                          : () => _handleSocialLogin(_SocialProviderInfo.apple),
                    ),
                    const SizedBox(width: Space.x4),
                    SocialCircleButton(
                      tooltip: '구글로 시작하기',
                      backgroundColor: AppColors.bg,
                      outlined: true,
                      icon: Text(
                        'G',
                        style: AppText.headline.copyWith(
                          color: const Color(0xFF4285F4),
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                      isLoading:
                          _loadingProvider ==
                          _SocialProviderInfo.google.backendCode,
                      onTap: anyLoading
                          ? null
                          : () =>
                                _handleSocialLogin(_SocialProviderInfo.google),
                    ),
                  ],
                ),
                const SizedBox(height: Space.x8),
                Row(
                  children: [
                    const Expanded(child: Divider()),
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: Space.x3),
                      child: Text('이메일로 로그인', style: AppText.caption),
                    ),
                    const Expanded(child: Divider()),
                  ],
                ),
                const SizedBox(height: Space.x5),
                TextField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  style: AppText.body,
                  decoration: const InputDecoration(hintText: '이메일'),
                ),
                const SizedBox(height: Space.x2),
                TextField(
                  controller: _passwordController,
                  obscureText: _obscurePassword,
                  autofillHints: const [AutofillHints.password],
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _handleEmailLogin(),
                  style: AppText.body,
                  decoration: InputDecoration(
                    hintText: '비밀번호',
                    suffixIcon: IconButton(
                      tooltip: _obscurePassword ? '비밀번호 보기' : '비밀번호 숨기기',
                      icon: Icon(
                        _obscurePassword
                            ? Icons.visibility_off_outlined
                            : Icons.visibility_outlined,
                        size: 20,
                        color: AppColors.inkTertiary,
                      ),
                      onPressed: () =>
                          setState(() => _obscurePassword = !_obscurePassword),
                    ),
                  ),
                ),
                const SizedBox(height: Space.x4),
                PrimaryButton(
                  label: '로그인',
                  loading: isLoading && _loadingProvider == null,
                  onPressed: _handleEmailLogin,
                  color: AppColors.ink,
                ),
                const SizedBox(height: Space.x2),
                Center(
                  child: TextButton(
                    onPressed: _handleSignUp,
                    child: Text.rich(
                      TextSpan(
                        children: [
                          const TextSpan(text: '처음이신가요? '),
                          TextSpan(
                            text: '이메일로 가입하기',
                            style: AppText.callout.copyWith(
                              color: AppColors.ink,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                      style: AppText.callout,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// 소셜 로그인 제공자 메타 정보.
///
/// [backendCode]는 백엔드 `AuthProvider` enum 값과 동일해야 한다.
/// [storageKey]는 기기에 제공자 고유 ID를 저장할 때 사용하는
/// shared_preferences 키다.
class _SocialProviderInfo {
  final String label;
  final String backendCode;
  final String storageKey;
  final Color color;
  final String emailDomainHint;

  const _SocialProviderInfo({
    required this.label,
    required this.backendCode,
    required this.storageKey,
    required this.color,
    required this.emailDomainHint,
  });

  static const kakao = _SocialProviderInfo(
    label: '카카오',
    backendCode: 'KAKAO',
    storageKey: 'social_kakao_provider_id',
    color: Color(0xFFFEE500),
    emailDomainHint: '@kakao.gachigacha.com',
  );

  static const google = _SocialProviderInfo(
    label: '구글',
    backendCode: 'GOOGLE',
    storageKey: 'social_google_provider_id',
    color: Color(0xFF4285F4),
    emailDomainHint: '@gmail.com',
  );

  static const naver = _SocialProviderInfo(
    label: '네이버',
    backendCode: 'NAVER',
    storageKey: 'social_naver_provider_id',
    color: Color(0xFF03C75A),
    emailDomainHint: '@naver.com',
  );

  static const apple = _SocialProviderInfo(
    label: 'Apple',
    backendCode: 'APPLE',
    storageKey: 'social_apple_provider_id',
    color: Color(0xFF1C1C1E),
    emailDomainHint: '@icloud.com',
  );
}

/// [_SocialConsentSheet]에서 사용자가 입력한 최초 가입용 프로필.
class _SocialProfileInput {
  final String email;
  final String nickname;

  const _SocialProfileInput({required this.email, required this.nickname});
}

/// 소셜 로그인 최초 연결 시 노출되는 동의/프로필 확인 바텀시트.
///
/// 실제 카카오/구글/네이버/Apple 네이티브 SDK는 앱 키 발급 및 각 사 개발자
/// 콘솔 등록이 필요해 이 샌드박스에서 재현할 수 없으므로, 제공자 로그인
/// 페이지로 이동한 뒤 계정 정보(이메일/닉네임) 제공에 동의하는 절차를
/// 동일하게 흉내낸 화면이다. 확인을 누르면 실제로 백엔드
/// `/auth/social-login`을 호출해 정식 계정을 생성/로그인한다.
class _SocialConsentSheet extends StatefulWidget {
  final _SocialProviderInfo info;

  const _SocialConsentSheet({required this.info});

  @override
  State<_SocialConsentSheet> createState() => _SocialConsentSheetState();
}

class _SocialConsentSheetState extends State<_SocialConsentSheet> {
  late final TextEditingController _emailController;
  late final TextEditingController _nicknameController;

  @override
  void initState() {
    super.initState();
    final suffix = Random().nextInt(9999).toString().padLeft(4, '0');
    _emailController = TextEditingController(
      text: 'user$suffix${widget.info.emailDomainHint}',
    );
    _nicknameController = TextEditingController(
      text: '${widget.info.label}유저$suffix',
    );
  }

  @override
  void dispose() {
    _emailController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  void _confirm() {
    final email = _emailController.text.trim();
    final nickname = _nicknameController.text.trim();
    if (email.isEmpty || nickname.isEmpty) return;
    Navigator.of(
      context,
    ).pop(_SocialProfileInput(email: email, nickname: nickname));
  }

  @override
  Widget build(BuildContext context) {
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
            '가치가차가 아래 정보로 계정을 만들어요.\n${widget.info.label} 인증은 아직 연결 전이라 이 화면에서 직접 확인받아요.',
            style: AppText.caption,
          ),
          const SizedBox(height: Space.x5),
          Text(
            '이메일',
            style: AppText.caption.copyWith(
              color: AppColors.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          TextField(controller: _emailController, style: AppText.body),
          const SizedBox(height: Space.x4),
          Text(
            '닉네임',
            style: AppText.caption.copyWith(
              color: AppColors.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 6),
          TextField(controller: _nicknameController, style: AppText.body),
          const SizedBox(height: Space.x6),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('취소'),
                ),
              ),
              const SizedBox(width: Space.x2),
              Expanded(
                flex: 2,
                child: FilledButton(
                  onPressed: _confirm,
                  child: const Text('동의하고 계속하기'),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

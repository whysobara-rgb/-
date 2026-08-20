import 'dart:math';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../../core/theme/app_colors.dart';
import '../../../shared/providers/auth_provider.dart';
import 'signup_page.dart';
import 'widgets/social_login_button.dart';

/// 가치가차 - 로그인 페이지
///
/// 소셜 로그인(카카오/구글/네이버/Apple) + 이메일 로그인(더미) + 회원가입 링크(더미)
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
    final profile = await showModalBottomSheet<_SocialProfileInput>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surfaceElevated,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(auth.errorMessage ?? '${info.label} 로그인에 실패했습니다'),
        ),
      );
    }
  }

  Future<void> _handleEmailLogin() async {
    final email = _emailController.text.trim();
    final password = _passwordController.text;
    if (email.isEmpty || password.isEmpty) {
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(const SnackBar(content: Text('이메일과 비밀번호를 입력해주세요')));
      return;
    }

    final auth = context.read<AuthProvider>();
    final success = await auth.login(email: email, password: password);
    if (!mounted) return;
    if (!success) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(auth.errorMessage ?? '로그인에 실패했습니다')),
      );
    }
  }

  void _handleSignUp() {
    Navigator.of(
      context,
    ).push(MaterialPageRoute(builder: (context) => const SignupPage()));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.scaffoldBg,
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 48),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 430),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _buildLogo(),
                  const SizedBox(height: 8),
                  _buildSlogan(),
                  const SizedBox(height: 36),
                  _buildSocialButtons(),
                  const SizedBox(height: 28),
                  _buildDivider(),
                  const SizedBox(height: 28),
                  _buildEmailField(),
                  const SizedBox(height: 12),
                  _buildPasswordField(),
                  const SizedBox(height: 20),
                  _buildLoginButton(),
                  const SizedBox(height: 16),
                  _buildSignUpLink(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ── 로고 & 슬로건 ────────────────────────────────────────────────
  Widget _buildLogo() {
    return ShaderMask(
      shaderCallback: (bounds) => AppColors.goldGradient.createShader(bounds),
      child: const Text(
        'GACHIGACHA',
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 38,
          fontWeight: FontWeight.w900,
          color: Colors.white,
          letterSpacing: 0.5,
        ),
      ),
    );
  }

  Widget _buildSlogan() {
    return const Text(
      '당신의 가치를 뽑아보세요',
      textAlign: TextAlign.center,
      style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
    );
  }

  // ── 소셜 로그인 버튼 4종 (기존 디자인 유지) ─────────────────────────
  Widget _buildSocialButtons() {
    final anyLoading = _loadingProvider != null;
    return Column(
      children: [
        SocialLoginButton(
          label: '카카오로 시작하기',
          backgroundColor: const Color(0xFFFEE500),
          foregroundColor: const Color(0xFF3C1E1E),
          icon: const Text(
            'K',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Color(0xFF3C1E1E),
            ),
          ),
          isLoading: _loadingProvider == _SocialProviderInfo.kakao.backendCode,
          disabled: anyLoading,
          onTap: () => _handleSocialLogin(_SocialProviderInfo.kakao),
        ),
        const SizedBox(height: 12),
        SocialLoginButton(
          label: '구글로 시작하기',
          backgroundColor: Colors.white,
          foregroundColor: const Color(0xFF333333),
          border: Border.all(color: AppColors.surfaceBorder),
          icon: const Text(
            'G',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Color(0xFF4285F4),
            ),
          ),
          isLoading: _loadingProvider == _SocialProviderInfo.google.backendCode,
          disabled: anyLoading,
          onTap: () => _handleSocialLogin(_SocialProviderInfo.google),
        ),
        const SizedBox(height: 12),
        SocialLoginButton(
          label: '네이버로 시작하기',
          backgroundColor: const Color(0xFF03C75A),
          foregroundColor: Colors.white,
          icon: const Text(
            'N',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w900,
              color: Colors.white,
            ),
          ),
          isLoading: _loadingProvider == _SocialProviderInfo.naver.backendCode,
          disabled: anyLoading,
          onTap: () => _handleSocialLogin(_SocialProviderInfo.naver),
        ),
        const SizedBox(height: 12),
        SocialLoginButton(
          label: 'Apple로 시작하기',
          backgroundColor: const Color(0xFF1C1C1E),
          foregroundColor: Colors.white,
          icon: const Icon(Icons.apple, size: 22, color: Colors.white),
          isLoading: _loadingProvider == _SocialProviderInfo.apple.backendCode,
          disabled: anyLoading,
          onTap: () => _handleSocialLogin(_SocialProviderInfo.apple),
        ),
      ],
    );
  }

  // ── "또는" 구분선 ────────────────────────────────────────────────
  Widget _buildDivider() {
    return const Row(
      children: [
        Expanded(child: Divider(color: AppColors.surfaceBorder)),
        Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Text(
            '또는',
            style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
          ),
        ),
        Expanded(child: Divider(color: AppColors.surfaceBorder)),
      ],
    );
  }

  // ── 이메일 입력 필드 ─────────────────────────────────────────────
  Widget _buildEmailField() {
    return _buildTextField(
      controller: _emailController,
      hintText: '이메일',
      prefixIcon: Icons.email_outlined,
      obscureText: false,
    );
  }

  // ── 비밀번호 입력 필드 ───────────────────────────────────────────
  Widget _buildPasswordField() {
    return _buildTextField(
      controller: _passwordController,
      hintText: '비밀번호',
      prefixIcon: Icons.lock_outline,
      obscureText: _obscurePassword,
      suffixIcon: IconButton(
        icon: Icon(
          _obscurePassword
              ? Icons.visibility_off_outlined
              : Icons.visibility_outlined,
          color: AppColors.textSecondary,
          size: 20,
        ),
        onPressed: () {
          setState(() => _obscurePassword = !_obscurePassword);
        },
      ),
    );
  }

  Widget _buildTextField({
    required TextEditingController controller,
    required String hintText,
    required IconData prefixIcon,
    required bool obscureText,
    Widget? suffixIcon,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceElevated2,
        borderRadius: BorderRadius.circular(12),
      ),
      child: TextField(
        controller: controller,
        obscureText: obscureText,
        style: const TextStyle(color: AppColors.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          hintText: hintText,
          hintStyle: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 14,
          ),
          prefixIcon: Icon(
            prefixIcon,
            color: AppColors.textSecondary,
            size: 20,
          ),
          suffixIcon: suffixIcon,
          border: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 16,
            vertical: 14,
          ),
        ),
      ),
    );
  }

  // ── 이메일 로그인 버튼 ───────────────────────────────────────────
  Widget _buildLoginButton() {
    final isLoading = context.watch<AuthProvider>().isLoading;
    return Container(
      width: double.infinity,
      height: 54,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(12),
        gradient: isLoading ? null : AppColors.goldGradient,
        color: isLoading ? AppColors.surfaceBorder : null,
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          onTap: isLoading ? null : _handleEmailLogin,
          borderRadius: BorderRadius.circular(12),
          child: Center(
            child: isLoading
                ? const SizedBox(
                    width: 22,
                    height: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      color: AppColors.textSecondary,
                    ),
                  )
                : const Text(
                    '이메일로 로그인',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: Color(0xFF1A1A1A),
                    ),
                  ),
          ),
        ),
      ),
    );
  }

  // ── 회원가입 링크 ────────────────────────────────────────────────
  Widget _buildSignUpLink() {
    return Center(
      child: TextButton(
        onPressed: _handleSignUp,
        child: RichText(
          text: const TextSpan(
            style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
            children: [
              TextSpan(text: '아직 계정이 없으신가요? '),
              TextSpan(
                text: '회원가입',
                style: TextStyle(
                  color: AppColors.goldPrimary,
                  fontWeight: FontWeight.w700,
                  decoration: TextDecoration.underline,
                  decorationColor: AppColors.goldPrimary,
                ),
              ),
            ],
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
    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 20,
        bottom: MediaQuery.of(context).viewInsets.bottom + 24,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.surfaceBorder,
                borderRadius: BorderRadius.circular(4),
              ),
            ),
          ),
          const SizedBox(height: 20),
          Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: widget.info.color,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 10),
              Text(
                '${widget.info.label} 계정으로 계속하기',
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          const Text(
            'GACHIGACHA가 아래 정보에 접근하도록 허용합니다.\n(이메일, 닉네임)',
            style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
          const SizedBox(height: 20),
          const Text(
            '이메일',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _emailController,
            style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
            decoration: InputDecoration(
              filled: true,
              fillColor: AppColors.surfaceElevated2,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
            ),
          ),
          const SizedBox(height: 14),
          const Text(
            '닉네임',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          TextField(
            controller: _nicknameController,
            style: const TextStyle(fontSize: 14, color: AppColors.textPrimary),
            decoration: InputDecoration(
              filled: true,
              fillColor: AppColors.surfaceElevated2,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(10),
                borderSide: BorderSide.none,
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  style: OutlinedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    side: const BorderSide(color: AppColors.surfaceBorder),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: const Text(
                    '취소',
                    style: TextStyle(color: AppColors.textSecondary),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: ElevatedButton(
                  onPressed: _confirm,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.goldPrimary,
                    foregroundColor: const Color(0xFF16161A),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                    elevation: 0,
                  ),
                  child: const Text(
                    '동의하고 계속하기',
                    style: TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/ui.dart';
import '../../../shared/providers/auth_provider.dart';
import '../domain/agreements.dart';
import 'welcome_gp_page.dart';
import 'widgets/agreement_panel.dart';

/// 이메일 가입. 필수 약관에 모두 동의해야 가입 버튼이 열린다.
///
/// 성공하면 [AuthProvider.signup]이 로그인까지 처리하고(AuthGate가 메인 탭으로
/// 전환), 이 화면은 닫히면서 가입 축하 GP 화면을 띄운다.
class SignupPage extends StatefulWidget {
  const SignupPage({super.key});

  @override
  State<SignupPage> createState() => _SignupPageState();
}

class _SignupPageState extends State<SignupPage> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _nicknameController = TextEditingController();
  bool _obscurePassword = true;
  Agreements _agreements = const Agreements();

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  Future<void> _handleSignup() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (!_agreements.allRequired) return;

    final auth = context.read<AuthProvider>();
    // 로그인되면 AuthGate가 바탕 화면을 메인 탭으로 바꾼다. 같은 내비게이터에서
    // 이 화면을 닫고 가입 축하 화면을 올린다.
    final navigator = Navigator.of(context);
    final success = await auth.signup(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      nickname: _nicknameController.text.trim(),
      agreements: _agreements,
    );

    if (success) {
      final welcomeGp = auth.takeWelcomeGp();
      navigator.pop();
      if (welcomeGp != null) navigator.push(WelcomeGpPage.route(welcomeGp));
      return;
    }
    if (mounted) showToast(context, auth.errorMessage ?? '가입하지 못했어요');
  }

  static String? validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) return '이메일을 입력해 주세요';
    final emailRegex = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    if (!emailRegex.hasMatch(value.trim())) return '이메일 형식을 확인해 주세요';
    return null;
  }

  static String? validatePassword(String? value) {
    if (value == null || value.isEmpty) return '비밀번호를 입력해 주세요';
    if (value.length < 8) return '8자 이상 입력해 주세요';
    if (value.length > 64) return '64자까지 입력할 수 있어요';
    final hasLetterAndDigit = RegExp(r'(?=.*[A-Za-z])(?=.*\d)');
    if (!hasLetterAndDigit.hasMatch(value)) {
      return '영문과 숫자를 함께 넣어 주세요';
    }
    return null;
  }

  static String? validateNickname(String? value) {
    if (value == null || value.trim().isEmpty) return '닉네임을 입력해 주세요';
    if (value.trim().length < 2) return '2자 이상 입력해 주세요';
    if (value.trim().length > 20) return '20자까지 입력할 수 있어요';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final auth = context.watch<AuthProvider>();
    final ready = _agreements.allRequired;
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('이메일로 가입')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              Space.gutter,
              Space.x2,
              Space.gutter,
              Space.x8,
            ),
            children: [
              Text('금고를 열 준비를 해요', style: AppText.title1),
              const SizedBox(height: Space.x1),
              Text('가입하면 축하 GP를 바로 드려요.', style: AppText.callout),
              const SizedBox(height: Space.x6),
              const _FieldLabel('이메일'),
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                textInputAction: TextInputAction.next,
                style: AppText.body,
                decoration: const InputDecoration(hintText: 'name@example.com'),
                validator: validateEmail,
              ),
              const SizedBox(height: Space.x4),
              const _FieldLabel('비밀번호'),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscurePassword,
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.next,
                style: AppText.body,
                decoration: InputDecoration(
                  hintText: '영문·숫자 포함 8자 이상',
                  suffixIcon: IconButton(
                    tooltip: _obscurePassword ? '비밀번호 보기' : '비밀번호 숨기기',
                    icon: Icon(
                      _obscurePassword
                          ? Icons.visibility_off_outlined
                          : Icons.visibility_outlined,
                      size: 20,
                      color: cs.onSurfaceVariant,
                    ),
                    onPressed: () =>
                        setState(() => _obscurePassword = !_obscurePassword),
                  ),
                ),
                validator: validatePassword,
              ),
              const SizedBox(height: Space.x4),
              const _FieldLabel('닉네임'),
              TextFormField(
                controller: _nicknameController,
                textInputAction: TextInputAction.done,
                style: AppText.body,
                decoration: const InputDecoration(hintText: '2~20자'),
                validator: validateNickname,
              ),
              const SizedBox(height: Space.x8),
              Text('약관 동의', style: AppText.title2),
              const SizedBox(height: Space.x3),
              AgreementPanel(
                value: _agreements,
                onChanged: (v) => setState(() => _agreements = v),
              ),
              const SizedBox(height: Space.x2),
              AnimatedSwitcher(
                duration: Motion.fast,
                child: Text(
                  ready
                      ? '마케팅 수신 동의는 나중에 MY에서 바꿀 수 있어요.'
                      : '필수 항목에 모두 동의해야 가입할 수 있어요.',
                  key: ValueKey(ready),
                  style: AppText.caption,
                ),
              ),
              const SizedBox(height: Space.x6),
              PrimaryButton(
                label: '동의하고 가입하기',
                loading: auth.isLoading,
                onPressed: ready ? _handleSignup : null,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: AppText.caption.copyWith(
        color: Theme.of(context).colorScheme.onSurface,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

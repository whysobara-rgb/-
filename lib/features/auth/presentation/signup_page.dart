import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/theme/app_colors.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/ui.dart';
import '../../../shared/providers/auth_provider.dart';

/// 이메일 가입. 성공하면 [AuthProvider.signup]이 로그인까지 처리하고,
/// 이 화면을 닫으면 AuthGate가 메인 탭으로 전환한다.
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

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _nicknameController.dispose();
    super.dispose();
  }

  Future<void> _handleSignup() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final auth = context.read<AuthProvider>();
    final success = await auth.signup(
      email: _emailController.text.trim(),
      password: _passwordController.text,
      nickname: _nicknameController.text.trim(),
    );

    if (!mounted) return;
    if (success) {
      Navigator.of(context).pop();
    } else {
      showToast(context, auth.errorMessage ?? '가입하지 못했어요');
    }
  }

  String? _validateEmail(String? value) {
    if (value == null || value.trim().isEmpty) return '이메일을 입력해 주세요';
    final emailRegex = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
    if (!emailRegex.hasMatch(value.trim())) return '이메일 형식을 확인해 주세요';
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return '비밀번호를 입력해 주세요';
    if (value.length < 8) return '8자 이상 입력해 주세요';
    final hasLetterAndDigit = RegExp(r'(?=.*[A-Za-z])(?=.*\d)');
    if (!hasLetterAndDigit.hasMatch(value)) {
      return '영문과 숫자를 함께 넣어 주세요';
    }
    return null;
  }

  String? _validateNickname(String? value) {
    if (value == null || value.trim().isEmpty) return '닉네임을 입력해 주세요';
    if (value.trim().length < 2) return '2자 이상 입력해 주세요';
    if (value.trim().length > 20) return '20자까지 입력할 수 있어요';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: const Text('이메일로 가입')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.fromLTRB(
              Space.gutter,
              Space.x3,
              Space.gutter,
              Space.x8,
            ),
            children: [
              Text('가입하면 바로 박스를 열 수 있어요.', style: AppText.callout),
              const SizedBox(height: Space.x6),
              _label('이메일'),
              TextFormField(
                controller: _emailController,
                keyboardType: TextInputType.emailAddress,
                style: AppText.body,
                decoration: const InputDecoration(hintText: 'name@example.com'),
                validator: _validateEmail,
              ),
              const SizedBox(height: Space.x4),
              _label('비밀번호'),
              TextFormField(
                controller: _passwordController,
                obscureText: _obscurePassword,
                style: AppText.body,
                decoration: InputDecoration(
                  hintText: '영문·숫자 포함 8자 이상',
                  suffixIcon: IconButton(
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
                validator: _validatePassword,
              ),
              const SizedBox(height: Space.x4),
              _label('닉네임'),
              TextFormField(
                controller: _nicknameController,
                style: AppText.body,
                decoration: const InputDecoration(hintText: '2~20자'),
                validator: _validateNickname,
              ),
              const SizedBox(height: Space.x8),
              PrimaryButton(
                label: '가입하기',
                loading: auth.isLoading,
                onPressed: _handleSignup,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _label(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 6),
    child: Text(
      text,
      style: AppText.caption.copyWith(
        color: AppColors.ink,
        fontWeight: FontWeight.w600,
      ),
    ),
  );
}

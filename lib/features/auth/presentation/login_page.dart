import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../../../core/domain/product_category.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../../../shared/widgets/ui.dart';
import '../../../shared/widgets/vault_art.dart';
import '../../../shared/providers/auth_provider.dart';
import '../domain/agreements.dart';
import 'signup_page.dart';
import 'terms_page.dart';

/// 로그인. 위는 금고 일러스트, 아래는 이메일 로그인.
class LoginPage extends StatefulWidget {
  const LoginPage({super.key});

  @override
  State<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends State<LoginPage> {
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
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
    ).push(MaterialPageRoute<void>(builder: (_) => const SignupPage()));
  }

  @override
  Widget build(BuildContext context) {
    final isLoading = context.watch<AuthProvider>().isLoading;
    return Scaffold(
      body: LayoutBuilder(
        builder: (context, constraints) => SingleChildScrollView(
          child: ConstrainedBox(
            constraints: BoxConstraints(minHeight: constraints.maxHeight),
            child: IntrinsicHeight(
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    LoginHero(
                      height: (constraints.maxHeight * 0.4).clamp(260, 360),
                    ),
                    Padding(padding: Space.page, child: _form(isLoading)),
                    const Spacer(),
                    const _LegalFooter(),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _form(bool isLoading) {
    final cs = Theme.of(context).colorScheme;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          '시계부터 아이폰까지,\n진짜 상품이 들어 있는 랜덤박스',
          style: AppText.title1.copyWith(height: 1.38),
        ),
        const SizedBox(height: Space.x3),
        const _Promises(),
        const SizedBox(height: Space.x8),
        TextField(
          controller: _emailController,
          keyboardType: TextInputType.emailAddress,
          autofillHints: const [AutofillHints.email],
          textInputAction: TextInputAction.next,
          style: AppText.body,
          decoration: InputDecoration(
            hintText: '이메일',
            prefixIcon: Icon(
              Icons.mail_outline,
              size: 20,
              color: cs.onSurfaceVariant,
            ),
          ),
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
            prefixIcon: Icon(
              Icons.lock_outline,
              size: 20,
              color: cs.onSurfaceVariant,
            ),
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
        ),
        const SizedBox(height: Space.x4),
        PrimaryButton(
          label: '로그인',
          loading: isLoading,
          onPressed: _handleEmailLogin,
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
                      color: cs.onSurface,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              style: AppText.callout,
            ),
          ),
        ),
      ],
    );
  }
}

/// 로그인 상단: 브랜드 색으로 빛나는 금고 상자 + 워드마크. 아래로 바탕색에 녹아든다.
class LoginHero extends StatelessWidget {
  final double height;
  const LoginHero({super.key, this.height = 300});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final top = MediaQuery.paddingOf(context).top;
    return SizedBox(
      height: height + top,
      child: Stack(
        fit: StackFit.expand,
        children: [
          // 기요셰가 상자 밖까지 그려지지 않게 자른다.
          ClipRect(
            child: BoxArt(
              tone: cs.primary,
              category: ProductCategory.jewel,
              scale: 0.5,
              centerY: 0.58,
            ),
          ),
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  cs.surface.withValues(alpha: 0),
                  cs.surface.withValues(alpha: 0),
                  cs.surface,
                ],
                stops: const [0, 0.62, 1],
              ),
            ),
          ),
          Positioned(
            left: Space.gutter,
            top: top + Space.x5,
            child: Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: '가치가차'),
                  TextSpan(
                    text: '.',
                    style: TextStyle(color: cs.primary),
                  ),
                ],
              ),
              style: AppText.display.copyWith(
                fontSize: 26,
                fontWeight: FontWeight.w900,
                letterSpacing: -1.1,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// 서비스가 실제로 지키는 세 가지(확률 공개·천장·실물 배송).
class _Promises extends StatelessWidget {
  const _Promises();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    const items = [
      (Icons.percent, '확률 공개'),
      (Icons.shield_outlined, '천장 보장'),
      (Icons.local_shipping_outlined, '실물 배송'),
    ];
    return Wrap(
      spacing: Space.x2,
      runSpacing: Space.x2,
      children: [
        for (final (icon, label) in items)
          Container(
            height: 28,
            padding: const EdgeInsets.symmetric(horizontal: 10),
            decoration: BoxDecoration(
              color: cs.surfaceContainer,
              borderRadius: Radii.pill,
              border: Border.all(color: cs.outlineVariant),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(icon, size: 14, color: cs.primary),
                const SizedBox(width: 5),
                Text(
                  label,
                  style: AppText.caption.copyWith(
                    color: cs.onSurface,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

/// 맨 아래 약관 링크.
class _LegalFooter extends StatelessWidget {
  const _LegalFooter();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    Widget link(TermsDocument doc) => TextButton(
      onPressed: () => Navigator.of(context).push(TermsPage.route(doc)),
      style: TextButton.styleFrom(
        minimumSize: const Size(0, 36),
        padding: const EdgeInsets.symmetric(horizontal: Space.x2),
      ),
      child: Text(
        doc.title,
        style: AppText.caption.copyWith(color: cs.onSurfaceVariant),
      ),
    );
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.only(bottom: Space.x2, top: Space.x4),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            link(TermsDocument.terms),
            Text('·', style: AppText.caption),
            link(TermsDocument.privacyPolicy),
          ],
        ),
      ),
    );
  }
}

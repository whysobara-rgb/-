import 'package:flutter/material.dart';
import '../../../core/theme/app_spacing.dart';
import '../../../core/theme/app_typography.dart';
import '../domain/agreements.dart';

/// 약관 보기.
///
/// **운영자 교체 필요.** 아래 본문은 화면 구성을 보여주기 위한 자리표시
/// 문안이다. 출시 전에 법률 검토를 거친 실제 약관으로 [_documents]를
/// 바꾸거나, 웹에 게시한 약관 URL을 열도록 바꿔야 한다.
class TermsPage extends StatelessWidget {
  final TermsDocument document;

  const TermsPage({super.key, required this.document});

  static Route<void> route(TermsDocument document) =>
      MaterialPageRoute<void>(builder: (_) => TermsPage(document: document));

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    final sections = _documents[document]!;
    return Scaffold(
      appBar: AppBar(titleSpacing: 0, title: Text(document.title)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          Space.gutter,
          Space.x2,
          Space.gutter,
          Space.x10,
        ),
        children: [
          const _PlaceholderNotice(),
          const SizedBox(height: Space.x6),
          for (final (heading, body) in sections) ...[
            Text(heading, style: AppText.headline),
            const SizedBox(height: Space.x2),
            Text(
              body,
              style: AppText.body.copyWith(color: cs.onSurfaceVariant),
            ),
            const SizedBox(height: Space.x6),
          ],
          Text(
            '시행일: [운영자 입력]',
            style: AppText.caption.copyWith(color: cs.onSurfaceVariant),
          ),
        ],
      ),
    );
  }
}

class _PlaceholderNotice extends StatelessWidget {
  const _PlaceholderNotice();

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Container(
      padding: const EdgeInsets.all(Space.x4),
      decoration: BoxDecoration(
        color: cs.error.withValues(alpha: 0.08),
        borderRadius: Radii.card,
        border: Border.all(color: cs.error.withValues(alpha: 0.45)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.edit_note, color: cs.error, size: 22),
          const SizedBox(width: Space.x3),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '견본 문안 · 운영자 교체 필요',
                  style: AppText.bodyStrong.copyWith(color: cs.error),
                ),
                const SizedBox(height: 4),
                Text(
                  '이 화면의 내용은 자리표시용 견본이에요. 출시 전에 법률 검토를 '
                  '거친 실제 문서로 바꿔야 해요.',
                  style: AppText.caption.copyWith(color: cs.onSurface),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

const _placeholder = '[견본] 이 조항은 자리표시 문안입니다. 운영자가 실제 내용으로 교체해야 합니다.';

/// 문서별 (제목, 본문) 목록. 전부 자리표시 문안이다.
const Map<TermsDocument, List<(String, String)>> _documents = {
  TermsDocument.terms: [
    ('제1조 (목적)', _placeholder),
    ('제2조 (정의)', '$_placeholder\n· GP: [운영자 입력]\n· 랜덤박스: [운영자 입력]'),
    ('제3조 (GP의 충전과 사용)', _placeholder),
    ('제4조 (랜덤박스와 확률 공개)', _placeholder),
    ('제5조 (상품 배송)', _placeholder),
    ('제6조 (청약철회와 환불)', _placeholder),
    ('제7조 (회원 탈퇴와 GP 소멸)', _placeholder),
    ('제8조 (분쟁 해결)', _placeholder),
  ],
  TermsDocument.privacy: [
    ('수집하는 항목', '$_placeholder\n· 필수: [운영자 입력]\n· 배송 신청 시: [운영자 입력]'),
    ('수집·이용 목적', _placeholder),
    ('보유·이용 기간', _placeholder),
    ('동의를 거부할 권리', _placeholder),
  ],
  TermsDocument.privacyPolicy: [
    ('개인정보의 처리 목적', _placeholder),
    ('처리하는 개인정보 항목', _placeholder),
    ('개인정보의 제3자 제공·처리 위탁', _placeholder),
    ('개인정보의 파기', _placeholder),
    ('정보주체의 권리', _placeholder),
    ('개인정보 보호책임자', '$_placeholder\n· 이름: [운영자 입력]\n· 연락처: [운영자 입력]'),
  ],
  TermsDocument.marketing: [
    ('수신 내용', _placeholder),
    ('수신 방법', _placeholder),
    ('동의 철회', '$_placeholder\nMY > 마케팅 정보 수신에서 언제든 끌 수 있어요.'),
  ],
};

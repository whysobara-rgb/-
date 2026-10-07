/// 가입할 때 받는 동의. 서버 `AgreementsDto`와 같은 네 항목이다.
///
/// 필수(이용약관·개인정보·만 14세)가 하나라도 빠지면 서버가 10010을 돌려주므로,
/// 화면은 [allRequired]가 true일 때만 가입 버튼을 연다.
enum AgreementItem {
  terms('이용약관 동의', required: true, document: TermsDocument.terms),
  privacy('개인정보 수집·이용 동의', required: true, document: TermsDocument.privacy),
  age14('만 14세 이상이에요', required: true),
  marketing('마케팅 정보 수신 동의', required: false, document: TermsDocument.marketing);

  const AgreementItem(this.label, {required this.required, this.document});

  final String label;
  final bool required;

  /// "보기"로 여는 문서. 없으면 링크를 숨긴다.
  final TermsDocument? document;
}

/// 약관 문서 종류. 본문은 `terms_page.dart`의 자리표시 문안(운영자 교체 필요).
enum TermsDocument {
  terms('이용약관'),
  privacy('개인정보 수집·이용 동의'),
  privacyPolicy('개인정보처리방침'),
  marketing('마케팅 정보 수신 동의');

  const TermsDocument(this.title);
  final String title;
}

class Agreements {
  final bool terms;
  final bool privacy;
  final bool age14;
  final bool marketing;

  const Agreements({
    this.terms = false,
    this.privacy = false,
    this.age14 = false,
    this.marketing = false,
  });

  /// 전체 동의.
  const Agreements.all()
    : terms = true,
      privacy = true,
      age14 = true,
      marketing = true;

  bool get allRequired => terms && privacy && age14;

  /// 선택 항목까지 모두 동의했는지(전체 동의 체크 상태).
  bool get all => allRequired && marketing;

  bool valueOf(AgreementItem item) => switch (item) {
    AgreementItem.terms => terms,
    AgreementItem.privacy => privacy,
    AgreementItem.age14 => age14,
    AgreementItem.marketing => marketing,
  };

  Agreements set(AgreementItem item, bool value) => Agreements(
    terms: item == AgreementItem.terms ? value : terms,
    privacy: item == AgreementItem.privacy ? value : privacy,
    age14: item == AgreementItem.age14 ? value : age14,
    marketing: item == AgreementItem.marketing ? value : marketing,
  );

  /// 전체 동의를 누른 결과: 모두 켜져 있었으면 모두 끄고, 아니면 모두 켠다.
  Agreements toggleAll() => all ? const Agreements() : const Agreements.all();

  Map<String, bool> toJson() => {
    'agreeTerms': terms,
    'agreePrivacy': privacy,
    'agreeAge14': age14,
    'agreeMarketing': marketing,
  };

  @override
  bool operator ==(Object other) =>
      other is Agreements &&
      other.terms == terms &&
      other.privacy == privacy &&
      other.age14 == age14 &&
      other.marketing == marketing;

  @override
  int get hashCode => Object.hash(terms, privacy, age14, marketing);
}

/// 가치가차 - 홈 화면 카테고리 필터 탭.
///
/// 추천/박스/명품/패션/신규 5개 탭으로 구성.
enum CapsuleCategory { recommend, box, luxury, fashion, brandNew }

extension CapsuleCategoryX on CapsuleCategory {
  /// 탭에 표시되는 한글 라벨
  String get label {
    switch (this) {
      case CapsuleCategory.recommend:
        return '추천';
      case CapsuleCategory.box:
        return '박스';
      case CapsuleCategory.luxury:
        return '명품';
      case CapsuleCategory.fashion:
        return '패션';
      case CapsuleCategory.brandNew:
        return '신규';
    }
  }
}

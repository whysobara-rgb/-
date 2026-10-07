# 가치가차 (gacha_vault)

실물 상품 랜덤박스 앱의 Flutter 클라이언트.

## 실행

백엔드 주소는 빌드할 때 넣는다(기본값 `http://localhost:3000`).

```sh
flutter pub get
flutter run --dart-define=API_BASE_URL=http://localhost:3000
flutter build web --release --no-web-resources-cdn --dart-define=API_BASE_URL=https://api.example.com
```

## 디자인 시스템

- 토큰: `lib/core/theme/` — 색(`app_colors.dart`), 타입 스케일(`app_typography.dart`),
  간격·모서리·모션(`app_spacing.dart`), 테마(`app_theme.dart`)
- 공용 위젯: `lib/shared/widgets/` (레어도 배지, 상품 이미지, 섹션·시트·상태 뷰)
- 숫자·금액·확률 포맷: `lib/core/utils/format.dart`

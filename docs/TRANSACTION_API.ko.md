# 거래 API 계약 초안 — 아직 서버에 구현되지 않음

목표 경로는 `/v1`. 현재 Flutter의 `/auth`, `/gachas`, `/draws`와는 별도 계약이다. 아래 경로를 존재하는 것처럼 호출하거나 기존 서버에 임의 배포하지 않는다. 백엔드 확인 뒤 OpenAPI와 계약 테스트로 고정한다.

공통: HTTPS, 사용자 access token, 서버 소유권 확인. 목록은 cursor 페이지네이션. 성공 응답은 `{statusCode:10000,data:...}`, 실패는 HTTP 상태와 `{statusCode,message,errors,requestId}`를 함께 사용한다. 금액은 정수. 서버 시각은 UTC ISO 8601, 한국 정책의 날짜 계산은 Asia/Seoul 기준. 개인정보·토큰을 로그에 남기지 않는다.

모든 거래 변경 요청에는 `Idempotency-Key`를 보낸다. 서버는 사용자/작업/키와 canonical 요청 해시를 저장하고 동일 요청은 최초 결과를 돌려준다. 같은 키·다른 내용은 409. 클라이언트는 키와 요청 ID를 전송 전에 영속 저장하고 상태 재조회가 끝날 때까지 새 키를 만들지 않는다. 보존 기간은 취소/재전송/대사 기간을 고려해 확정한다.

| 동작 | 요청 | 서버의 필수 처리/응답 |
| --- | --- | --- |
| 인증 교환 | `POST /v1/auth/oauth/exchange` provider, code, redirectUri, PKCE verifier/nonce 계약 | 제공자 서명/issuer/audience/만료/nonce 검증; subject 직접 입력 신뢰 금지; access/refresh 발급 |
| 내 정보 | `GET /v1/me` | GP 잔액, 본인확인/정책 동의 상태, 허용 작업 |
| 캡슐 상세 | `GET /v1/capsule-types/{id}` | 원화 가격, GP 가격, 판매 잔여 수량, 확률 모드/버전, 개별·등급 확률, 전환 규칙, 서버 구매 한도 |
| 주문 생성 | `POST /v1/orders` capsuleTypeId, quantity, paymentMethod | 서버 가격·수량·연령·정책 확인; 주문과 가격 스냅샷; 다날 결제 시작 정보 또는 원장 GP 차감+지급 |
| 결제 콜백 | `POST /v1/webhooks/danal` 다날 명세 원문 | 진위·주문·금액 대조, 이벤트 중복 제거, 승인/취소 역순 처리, 미지급 재처리; 실제 필드/서명 방식은 계약 확인 후 구현 |
| 주문 확인 | `GET /v1/orders/{id}` | PENDING_PAYMENT/PAID/FULFILLING/FULFILLED/REFUND_PENDING/REFUNDED/FAILED 및 승인·지급 세부 상태 |
| 미개봉 캡슐 | `GET /v1/me/capsules?cursor=...` | 소유권 ID, 원주문, 상태, 환불 가능 기한, 적용 확률 버전 |
| 환불 견적 | `POST /v1/refund-quotes` ownedCapsuleIds | 미개봉 여부·원결제 수단·정책·환불액·기한 검증, quoteId/expiry |
| 환불 실행 | `POST /v1/refunds` quoteId | 개봉과 경합 차단, PG 취소/GP 원장 보정, 대사 상태. PG 완료 전에 완료라고 응답하지 않음 |
| 개봉 | `POST /v1/draws` ownedCapsuleIds | 전체 ID 소유권·중복·미개봉 검사, 서버 추첨, 원자적 소비·결과·지급; drawId, results, probabilityVersion |
| 결과 복구 | `GET /v1/draws/{id}` 또는 `GET /v1/operations/{key}` | 동일 사용자에만 처리중/완료/실패와 확정 결과 반환 |
| 상품 보관함 | `GET /v1/me/inventory` | 상태, 잠금, 소비자가·전환 GP 스냅샷, canShip/canConvert, 불가 사유 |
| 잠금 | `PUT /v1/inventory/{id}/lock` locked | 소유권 검증, 명시적 true/false, 전환과 경합 처리 |
| 전환 견적 | `POST /v1/conversion-quotes` inventoryItemIds | 상품별 GP·비율·복구 조건·정책 버전·견적 만료; 잠금/상태 확인 |
| 전환 실행 | `POST /v1/conversions` quoteId | 상태 재검사, 상품 전환 처리와 GP 원장 적립 한 트랜잭션 |
| 전환 복구 | `POST /v1/conversions/{id}/restore` | 원적립 소비 배분·기한·횟수 검사, 원장 반대 거래+상품 상태 복구 |
| GP 내역 | `GET /v1/me/gp-ledger` | 출처, 증감, 거래 후 잔액, 원주문/전환 참조; 충전 API 없음 |
| GP 마켓 구매 | `POST /v1/market-orders` productId, quantity | 서버 가격·재고·GP 확인, 원장 차감+상품 지급 원자 처리 |
| 장바구니 | `PUT /v1/me/cart` inventoryItemIds | 소유 상품만, 잠금과 독립, 배송 불가 상품 사유 |
| 배송 견적 | `POST /v1/shipping-quotes` inventoryItemIds, addressId | 묶음 그룹·도서산간·실물/디지털 분리, 실제 비용, 만료 시각 |
| 배송 요청 | `POST /v1/shipments` quoteId, recipient snapshot, notes | 소유권·상태·견적 재확인, GP/결제 확인, 배송과 상품 상태 전이 |
| 배송 취소 | `POST /v1/shipments/{id}/cancel` reason | PREPARING까지만, 실제 비용만 복구, 상품 상태 재설정 |
| 배송 조회 | `GET /v1/shipments/{id}` | PREPARING/COLLECTED/IN_TRANSIT/DELIVERED/CANCELLED, 추적 정보; 주소 변경 없음 |
| 문의 | `POST /v1/support-tickets` order/item refs, category, body, attachmentIds | 소유권, 파일 유형·크기·악성 파일 검사, 담당 처리 기록 |
| 탈퇴 요청 | `POST /v1/me/withdrawal` | 남은 거래/재화 안내·동의, 세션 취소, 삭제/의무 보관 분리 |

## 개봉 응답 예시

```json
{
  "statusCode": 10000,
  "data": {
    "drawId": "draw_example",
    "state": "COMMITTED",
    "probabilityVersion": "pv_example",
    "results": [{
      "ownedCapsuleId": "cap_example",
      "inventoryItemId": "inv_example",
      "productId": "product_example",
      "grade": "A",
      "retailPriceWon": 15000,
      "conversionGp": 1500,
      "conversionPolicyVersion": "cp_example"
    }]
  }
}
```

이 예시는 테스트용 계약이며 실제 당첨 데이터가 아니다. UI는 위 COMMITTED 응답 후 연출하고 종료/스킵 시 공개한다. `conversionGp`를 앱에서 상품 가격의 임의 비율로 다시 계산하지 않는다. 미확정 응답이나 timeout은 신규 개봉 버튼으로 연결하지 않고 같은 요청 상태를 조회한다.

## 관리자 최소 계약

상품 엑셀은 업로드 → 서버 행별 검증 결과/미리보기 → 확정 단계로 나눈다. 외부 URL 이미지는 서버에서 허용 도메인·크기·타입을 검증해 가져오고 내부망 접근을 차단한다. 확률 버전은 DRAFT → VALIDATED → APPROVED → ACTIVE → RETIRED이며 활성 버전 내용을 덮어쓰지 않는다. 기존 캡슐의 적용 버전을 보존한다. 가격·확률·수동 GP 보상·환불에는 actor, reason, before/after, requestId와 승인 정보를 기록한다.

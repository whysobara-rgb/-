// Generated from fixture.json. Review entrypoint only; never imported by lib/.
const unifiedFixtureJson = r'''
{
  "schema": "UNIFIED_UX_REVIEW_V1",
  "kind": "synthetic, read-only, no server transactions",
  "balance": 9900,
  "boxes": [
    {
      "id": 901,
      "title": "취향을 채우는 컬렉션 박스",
      "category": "tech",
      "price": 1000,
      "currency": "GP",
      "totalStock": 1000,
      "soldStock": 120,
      "imageUrl": null,
      "active": true,
      "description": "구성 상품과 공개 확률을 확인하고 나만의 컬렉션을 시작하세요."
    },
    {
      "id": 902,
      "title": "작은 행복, 데일리 박스",
      "category": "home",
      "price": 100,
      "currency": "GP",
      "totalStock": 1000,
      "soldStock": 120,
      "imageUrl": null,
      "active": true,
      "description": "구성 상품과 공개 확률을 확인하고 나만의 컬렉션을 시작하세요."
    },
    {
      "id": 903,
      "title": "새로운 발견",
      "category": "other",
      "price": 500,
      "currency": "GP",
      "totalStock": 1000,
      "soldStock": 120,
      "imageUrl": null,
      "active": true,
      "description": "구성 상품과 공개 확률을 확인하고 나만의 컬렉션을 시작하세요."
    }
  ],
  "odds": {
    "gachaId": 901,
    "unitPrice": 1000,
    "currency": "GP",
    "version": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "snapshot": {
      "schemaVersion": 1,
      "mode": "FIXED_PPM",
      "entries": [
        {
          "itemId": 1,
          "name": "일반 컬렉션 카드",
          "rarity": "N",
          "conversionGP": 0,
          "probabilityPpm": 900000,
          "isPremium": false
        },
        {
          "itemId": 2,
          "name": "프리미엄 컬렉션 카드",
          "rarity": "SSR",
          "conversionGP": 0,
          "probabilityPpm": 100000,
          "isPremium": true
        }
      ]
    }
  }
}
''';

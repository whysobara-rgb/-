#!/usr/bin/env python3
"""체험판(DEMO_MODE) 카탈로그 스냅샷.

실제 서버의 공개 카탈로그를 읽어 assets/demo/catalog.json으로 저장한다.
체험판은 이 파일만 보고 박스·확률·배너·충전 패키지를 보여준다.

읽기 전용 요청만 보낸다(GET, 그리고 GET에 필요한 로그인).
- GET /gachas, /gachas/:id, /gachas/:id/odds   (판매 중인 모든 박스)
- GET /banners                                  (지금 노출 중인 배너)
- GET /admin/banners                            (위 배너들의 priority/active만)
- GET /payments/config                          (충전 패키지·첫 충전 보너스 규칙)

사용법:
  python3 tool/demo/snapshot_catalog.py [--base http://localhost:3000]
"""

import argparse
import datetime
import json
import os
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "assets", "demo", "catalog.json")

# 프록시를 거치지 않는다(로컬 개발 서버).
OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(base, method, path, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with OPENER.open(req, timeout=15) as res:
        envelope = json.loads(res.read().decode("utf-8"))
    if envelope.get("statusCode") != 10000:
        raise SystemExit(f"{method} {path} failed: {envelope}")
    return envelope["data"]


def login(base, email, password):
    return call(base, "POST", "/auth/login", {"email": email, "password": password})["accessToken"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:3000")
    ap.add_argument("--user", default="demo@gachivault.com")
    ap.add_argument("--admin", default="admin@gachivault.com")
    ap.add_argument("--password", default="Password1")
    args = ap.parse_args()
    base = args.base.rstrip("/")

    listing = call(base, "GET", "/gachas?page=1&limit=100")
    gachas = listing["items"]
    details = {}
    odds = {}
    for g in gachas:
        gid = str(g["id"])
        details[gid] = call(base, "GET", f"/gachas/{gid}")
        odds[gid] = call(base, "GET", f"/gachas/{gid}/odds")

    banners = call(base, "GET", "/banners")["items"]

    admin_token = login(base, args.admin, args.password)
    admin_banners = {b["id"]: b for b in call(base, "GET", "/admin/banners", token=admin_token)["items"]}
    banner_meta = {
        str(b["id"]): {
            "priority": admin_banners.get(b["id"], {}).get("priority", 100),
            "active": admin_banners.get(b["id"], {}).get("active", True),
        }
        for b in banners
    }

    user_token = login(base, args.user, args.password)
    config = call(base, "GET", "/payments/config", token=user_token)
    packages = [
        {k: p[k] for k in ("id", "price", "gp", "bonusGp")} for p in config["packages"]
    ]
    first = config["firstTopupBonus"]

    snapshot = {
        "source": base,
        "snapshotAt": datetime.datetime.now(datetime.timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
        "note": "실제 서버 응답 그대로. soldStock/soldOut은 체험판에서 0부터 다시 센다.",
        "gachas": gachas,
        "details": details,
        "odds": odds,
        "banners": banners,
        "bannerMeta": banner_meta,
        "payments": {
            "packages": packages,
            "firstTopupBonus": {"rate": first["rate"], "maxGp": first["maxGp"]},
        },
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(snapshot, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(
        f"wrote {OUT}: {len(gachas)} boxes "
        f"({', '.join(str(g['id']) for g in gachas)}), "
        f"{sum(len(o['items']) for o in odds.values())} pool entries, "
        f"{len(banners)} banners, {len(packages)} packages"
    )


if __name__ == "__main__":
    main()

// 세이브 계층: 서버(Node)가 있으면 서버별·플레이어별 파일에 저장,
// 서버 없이 열렸으면 브라우저 저장소에 "서버ID + 콜사인" 별로 분리 저장한다.
import { hashStr } from './data.js';

export function newProfile() {
  return {
    v: 1, coins: 3000, nextUid: 3,
    weapons: [{ uid: 1, id: 'pistol_0' }, { uid: 2, id: 'rifle_0' }],
    loadout: [1, 2, null, null],
    armors: ['a0'], armor: 'a0',
    clears: 0, deaths: 0, kills: 0, bestKills: 0,
    gachaSeed: 1, shopDay: '', shopBought: [],
    settings: { sens: 1.0, vol: 0.6, fov: 85 },
  };
}

export class SaveStore {
  constructor() { this.mode = 'local'; this.token = null; this.server = null; this.name = null; }

  get playerId() { return String(hashStr(this.server + ':' + this.name.toLowerCase())); }

  async login(server, name, pin) {
    this.server = server; this.name = name.trim();
    try {
      const r = await fetch('api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server, name: this.name, pin }),
      });
      if (r.status === 404 || r.status === 405 || r.status === 501) throw new Error('no-server');
      const j = await r.json();
      if (!r.ok) return { error: j.error || '로그인 실패' };
      this.mode = 'server'; this.token = j.token;
      return { data: j.data ? migrate(j.data) : newProfile(), created: j.created };
    } catch (e) {
      // 정적 호스팅/파일로 실행된 경우: 로컬 분리 저장
      this.mode = 'local';
      const key = this.localKey();
      let rec = null;
      try { rec = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* 저장소 차단 */ }
      const pinHash = String(hashStr('pin:' + pin + ':' + key));
      if (rec && rec.pinHash !== pinHash) return { error: 'PIN이 일치하지 않습니다' };
      if (!rec) { rec = { pinHash, data: null }; this.writeLocal(rec); }
      this.localRec = rec;
      return { data: rec.data ? migrate(rec.data) : newProfile(), created: !rec.data };
    }
  }

  localKey() { return `riftbreaker::${this.server}::${this.name.toLowerCase()}`; }
  writeLocal(rec) { try { localStorage.setItem(this.localKey(), JSON.stringify(rec)); } catch { /* 무시 */ } }

  async save(data) {
    if (this.mode === 'server') {
      try {
        await fetch('api/save', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token },
          body: JSON.stringify({ data }),
        });
      } catch { /* 네트워크 일시 오류는 다음 저장에서 복구 */ }
    } else {
      this.localRec.data = data;
      this.writeLocal(this.localRec);
    }
  }
}

function migrate(d) {
  const base = newProfile();
  const out = Object.assign(base, d);
  out.settings = Object.assign(newProfile().settings, d.settings || {});
  return out;
}

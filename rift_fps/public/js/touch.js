// 모바일 터치 조작: 왼쪽 가상 조이스틱(이동), 오른쪽 드래그(시점), 화면 버튼(사격·점프·스킬 등)
export function setupTouch(game) {
  if (!game.mobile) return;
  document.body.classList.add('touch');
  const root = document.getElementById('touchUI');
  const joy = root.querySelector('.joy'), knob = joy.querySelector('i');
  const R = 56;
  let moveId = null, ox = 0, oy = 0;
  const looks = new Map(); // pointerId -> 마지막 좌표 (시점 드래그·사격 버튼 드래그 공용)

  const zone = root.querySelector('.tz-move');
  zone.addEventListener('pointerdown', (e) => {
    if (moveId !== null) return;
    moveId = e.pointerId; ox = e.clientX; oy = e.clientY;
    const zr = zone.getBoundingClientRect(); // 조이스틱은 영역 기준 좌표로 배치
    joy.style.left = (ox - zr.left) + 'px'; joy.style.top = (oy - zr.top) + 'px'; joy.classList.add('on');
    zone.setPointerCapture(e.pointerId);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== moveId) return;
    let dx = e.clientX - ox, dy = e.clientY - oy; const l = Math.hypot(dx, dy);
    if (l > R) { dx *= R / l; dy *= R / l; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    game.touchMove.x = dx / R; game.touchMove.y = -dy / R;
    game.keys.ShiftLeft = l > R * 0.95; // 끝까지 밀면 질주
  });
  const endMove = (e) => {
    if (e.pointerId !== moveId) return;
    moveId = null; game.touchMove.x = game.touchMove.y = 0; game.keys.ShiftLeft = false;
    knob.style.transform = ''; joy.classList.remove('on'); joy.style.left = ''; joy.style.top = '';
  };
  zone.addEventListener('pointerup', endMove); zone.addEventListener('pointercancel', endMove);

  const lookStart = (el) => (e) => { looks.set(e.pointerId, [e.clientX, e.clientY]); el.setPointerCapture(e.pointerId); };
  const lookMove = (e) => {
    const last = looks.get(e.pointerId); if (!last) return;
    game.look(e.clientX - last[0], e.clientY - last[1]); last[0] = e.clientX; last[1] = e.clientY;
  };
  const lookEnd = (e) => looks.delete(e.pointerId);
  const lookZone = root.querySelector('.tz-look');
  lookZone.addEventListener('pointerdown', lookStart(lookZone));
  for (const el of [lookZone]) { el.addEventListener('pointermove', lookMove); el.addEventListener('pointerup', lookEnd); el.addEventListener('pointercancel', lookEnd); }

  const acts = {
    jump: () => game.jump(), reload: () => game.startReload(), wskill: () => game.weaponSkill(),
    swap: () => game.switchWeapon((game.cur + 1) % game.slots.length),
    aim: (b) => { game.aiming = !game.aiming; b.classList.toggle('on', game.aiming); },
    pause: () => game.pause(),
    dash: () => game.skill('dash'), shock: () => game.skill('shock'), over: () => game.skill('over'), nade: () => game.skill('nade'), slash: () => game.skill('slash'),
  };
  root.querySelectorAll('[data-act]').forEach((b) => {
    const act = b.dataset.act;
    if (act === 'fire') {
      // 사격 버튼: 누르고 있는 동안 연사, 누른 채로 끌면 시점도 함께 회전
      b.addEventListener('pointerdown', (e) => { game.mouseDown = true; game.triggerPulled = true; b.classList.add('on'); lookStart(b)(e); });
      b.addEventListener('pointermove', lookMove);
      const up = (e) => { game.mouseDown = false; b.classList.remove('on'); lookEnd(e); };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    } else {
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); acts[act] && acts[act](b); b.classList.add('on'); setTimeout(() => act !== 'aim' && b.classList.remove('on'), 120); });
    }
  });
  // 브라우저 기본 제스처(스크롤·확대·길게 눌러 메뉴) 차단
  root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
}

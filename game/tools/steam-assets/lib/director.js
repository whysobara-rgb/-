/*
 * Scene director for the steam-asset capture (injected with page.addInitScript; used after the
 * real game has booted and a real match is running).
 *
 * It only does what a staging tool for real gameplay moments needs:
 *   - puts characters / loot where the moment happens with the sim's own debug teleport
 *     (sim.debug.* — the same API the dev view harness and the tests use), and
 *   - feeds REAL Commands (move / grab / dash / aim) for the characters each tick, through the
 *     match's MatchScript autopilot hook (the human slot) and the bots' update() (bot slots).
 * Everything that follows — physics, uproot, recovery, police, HUD, camera, FX, audio — is the
 * unmodified game reacting to those commands. Slots without a controller keep their real AI.
 */
(() => {
  const ZERO = { x: 0, y: 0 };
  const cmd = (move, grab, aim, dash = false) => ({ move: move ?? ZERO, grab: !!grab, dash: !!dash, aim: aim ?? null, ping: null });
  const norm = (v) => {
    const l = Math.hypot(v.x, v.y);
    return l < 1e-6 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
  };

  const D = {
    ctl: new Map(),
    match: null,
    log: [],
    get app() {
      return window.__uproot && window.__uproot.app;
    },
    get sim() {
      return D.match ? D.match.sim : null;
    },

    /** Take over command input of the running match (human slot + bots). */
    hijack() {
      const m = D.app && D.app.currentMatch;
      if (!m) throw new Error('no match');
      if (D.match === m) return true;
      D.match = m;
      D.ctl.clear();
      // ?autotest drives the human slot with a proxy bot: the staged commands replace it.
      m.proxy = null;
      m.attachScript({
        autopilot: (sim) => {
          const f = D.ctl.get(0);
          return f ? f(sim) : null;
        },
        onEvents: (events) => {
          for (const e of events) D.log.push(e);
        },
        update() {},
        focusTargets: () => [],
        finished: false,
        dispose() {},
      });
      for (const b of m.bots) {
        const orig = b.update.bind(b);
        b.update = (sim) => {
          const f = D.ctl.get(b.slot);
          return f ? f(sim) : orig(sim);
        };
      }
      return true;
    },

    /** Snap the game camera to its goal (what the view does itself when the focus teleports). */
    snapCamera() {
      const v = D.app.d.view;
      if (v && v.cam && typeof v.cam.snap === 'function') v.cam.snap();
    },
    /** Mark every achievement as already earned (no unlock toasts over staged screenshots). */
    quietAchievements(ids) {
      const d = window.__uproot.save();
      for (const id of ids) if (!d.achievements.includes(id)) d.achievements.push(id);
      return d.achievements.length;
    },
    set(slot, fn) {
      D.ctl.set(slot, fn);
    },
    free(slot) {
      D.ctl.delete(slot);
    },

    // --- controllers -----------------------------------------------------------------------
    idle(aim) {
      return () => cmd(ZERO, false, aim ?? null);
    },
    /** Hold grab while pushing the stick in `dir`, facing `aim`. */
    hold(dir, aim, grab = true) {
      return () => cmd(norm(dir), grab, aim);
    },
    /** Walk toward `to` (stops within `stop` m), optionally holding grab. */
    walk(slot, to, o = {}) {
      return (sim) => {
        const c = sim.state.characters[slot];
        const dx = to.x - c.pos.x;
        const dy = to.y - c.pos.y;
        const d = Math.hypot(dx, dy);
        const stop = o.stop ?? 0.3;
        if (d < stop) return cmd(ZERO, !!o.grab, o.faceAt ? norm({ x: o.faceAt.x - c.pos.x, y: o.faceAt.y - c.pos.y }) : null);
        const k = Math.min(1, d / 0.8) * (o.speed ?? 1);
        return cmd({ x: (dx / d) * k, y: (dy / d) * k }, !!o.grab, null);
      };
    },
    /** A sequence of [ticks, controller] steps (last one repeats). */
    seq(steps) {
      let i = 0;
      let n = 0;
      return (sim) => {
        while (i < steps.length - 1 && n >= steps[i][0]) {
          i++;
          n = 0;
        }
        n++;
        return steps[i][1](sim);
      };
    },

    // --- queries -------------------------------------------------------------------------------
    banks() {
      return D.sim.state.loot.filter((l) => l.kind === 'bank');
    },
    loot(id) {
      return D.sim.getLoot(id);
    },
    charId(slot) {
      return D.sim.state.characters[slot].id;
    },
    tp(id, pos, angle) {
      D.sim.debug.teleport(id, pos, angle);
    },
    events(type) {
      return D.log.filter((e) => e.type === type);
    },
    hasEvent(type) {
      return D.log.some((e) => e.type === type);
    },
    clearLog() {
      D.log.length = 0;
    },
    state() {
      const s = D.sim.state;
      return {
        tick: s.tick,
        scores: s.scores.slice(),
        final: !!s.finalCountdown,
        over: !!s.over,
        phase: D.match.state,
        chars: s.characters.map((c) => ({ slot: c.slot, x: +c.pos.x.toFixed(2), y: +c.pos.y.toFixed(2), grab: c.grab ? c.grab.targetId : null, strain: c.straining, kd: c.knockdownTicks })),
        banks: D.banks().map((b) => ({ id: b.id, x: +b.pos.x.toFixed(2), y: +b.pos.y.toFixed(2), anchored: b.anchored, p: +b.unanchorProgress.toFixed(2), est: b.estimatedValue, rec: b.recovered })),
        view: (() => {
          try {
            const v = D.app.d.view;
            const u = v.post && v.post.grade ? v.post.grade.uniforms : null;
            return { cam: v.camera.position.toArray().map((x) => +x.toFixed(1)), flash: u ? +u.uFlash.value.toFixed(3) : null, flashRaw: v.post ? +(v.post.flash || 0).toFixed(3) : null, flashColor: u ? u.uFlashColor.value.getHexString() : null, impact: u ? u.uImpact.value : null, chroma: u ? +u.uChroma.value.toFixed(3) : null };
          } catch (e) {
            return String(e);
          }
        })(),
        police: (s.police || []).map((o) => ({ id: o.id, phase: o.phase, x: +o.pos.x.toFixed(1), y: +o.pos.y.toFixed(1), t: o.targetCharId })),
      };
    },
    /** A free spot near `p` (spiral search) for a body of radius r. */
    freeNear(p, r = 0.6) {
      const sim = D.sim;
      if (sim.isFree(p, r)) return p;
      for (let rad = 0.5; rad < 12; rad += 0.5) {
        for (let k = 0; k < 16; k++) {
          const q = { x: p.x + Math.cos((k / 16) * Math.PI * 2) * rad, y: p.y + Math.sin((k / 16) * Math.PI * 2) * rad };
          if (sim.isFree(q, r)) return q;
        }
      }
      return p;
    },
  };

  // =============================================================================================
  // Staged moments (each on a real layout, inside a real running match)
  // =============================================================================================

  const S = {};

  /**
   * Whole-bank uproot: the player and the teammate hang on the camera-side (south) wall of the
   * north bank and pull; the rivals come running. The view's uproot choreography (roots, cracks,
   * the pop) and the HUD "은행째!" stamp are the game's own reaction.
   */
  S.uproot = (o = {}) => {
    const b = D.banks()[0];
    const n = D.sim.state.characters.length;
    if (o.side === 'south') {
      const faceY = b.pos.y + 4 + 0.55;
      D.tp(D.charId(0), { x: b.pos.x - 1.3, y: faceY }, -Math.PI / 2);
      D.tp(D.charId(1), { x: b.pos.x + 1.35, y: faceY + 0.05 }, -Math.PI / 2);
      D.set(0, D.hold({ x: 0.15, y: 1 }, { x: 0, y: -1 }));
      D.set(1, D.hold({ x: -0.1, y: 1 }, { x: 0, y: -1 }));
    } else {
      // West wall (bank side, in profile from the camera), one raccoon each side of the door.
      const faceX = b.pos.x - 3 - 0.55;
      D.tp(D.charId(0), { x: faceX, y: b.pos.y + 2.3 }, 0);
      D.tp(D.charId(1), { x: faceX, y: b.pos.y - 2.4 }, 0);
      D.set(0, D.hold({ x: -1, y: 0.12 }, { x: 1, y: 0 }));
      D.set(1, D.hold({ x: -1, y: -0.1 }, { x: 1, y: 0 }));
    }
    if (n > 2) {
      D.tp(D.charId(2), D.freeNear({ x: b.pos.x - 13, y: b.pos.y + 9 }), -Math.PI / 4);
      D.set(2, D.walk(2, { x: b.pos.x - 7.2, y: b.pos.y + 5.2 }, { speed: 0.85, faceAt: b.pos }));
    }
    if (n > 3) {
      D.tp(D.charId(3), D.freeNear({ x: b.pos.x - 14, y: b.pos.y - 3 }), 0);
      D.set(3, D.walk(3, { x: b.pos.x - 8.2, y: b.pos.y - 1.5 }, { speed: 0.75, faceAt: b.pos }));
    }
    return { bankId: b.id };
  };

  /**
   * Steal from a moving bank: the rivals drag the (uprooted) north bank east; the player slips
   * in through the west door and pulls the 300 safe out while the bank keeps going.
   */
  S.steal = () => {
    const b = D.banks()[0];
    D.sim.debug.setAnchored(b.id, false);
    const large = D.sim.state.loot.find((l) => l.kind === 'largeSafe' && l.homeBank === b.id);
    D.sim.debug.setAnchored(large.id, false);
    D.tp(large.id, { x: b.pos.x - 2.15, y: b.pos.y }, 0);
    D.tp(D.charId(0), { x: b.pos.x - 3.55, y: b.pos.y }, 0);
    D.set(0, D.seq([[50, D.hold({ x: 0, y: 0 }, { x: 1, y: 0 })], [1, D.hold({ x: -1, y: 0.0 }, { x: 1, y: 0 })]]));
    const n = D.sim.state.characters.length;
    const rival = n > 2 ? 2 : 1;
    D.tp(D.charId(rival), { x: b.pos.x + 3.55, y: b.pos.y + 2.6 }, Math.PI);
    D.set(rival, D.hold({ x: 1, y: 0.05 }, { x: -1, y: 0 }));
    if (n > 3) {
      D.tp(D.charId(3), { x: b.pos.x + 3.55, y: b.pos.y - 2.4 }, Math.PI);
      D.set(3, D.hold({ x: 1, y: -0.05 }, { x: -1, y: 0 }));
    }
    if (n > 2) {
      // The teammate covers the door from the plaza.
      D.tp(D.charId(1), D.freeNear({ x: b.pos.x - 7.5, y: b.pos.y + 5.5 }), -Math.PI / 4);
      D.set(1, D.walk(1, { x: b.pos.x - 5.8, y: b.pos.y + 3.4 }, { speed: 0.5, faceAt: { x: b.pos.x - 3, y: b.pos.y } }));
    }
    return { bankId: b.id, safeId: large.id };
  };

  /**
   * Fence bust (shortcut layout): the player and the teammate haul the north bank south by its
   * side walls straight into the weak fence.
   */
  S.fence = (o = {}) => {
    const b = D.banks()[0];
    D.sim.debug.setAnchored(b.id, false);
    const fence = D.sim.layout.fences[0];
    const gap = o.gap ?? 1.2;
    D.tp(b.id, { x: fence.center.x, y: fence.center.y - 4 - gap }, b.angle);
    const nb = D.loot(b.id);
    if (o.style === 'push') {
      D.tp(D.charId(0), { x: nb.pos.x - 1.6, y: nb.pos.y - 4.55 }, Math.PI / 2);
      D.tp(D.charId(1), { x: nb.pos.x + 1.6, y: nb.pos.y - 4.55 }, Math.PI / 2);
      D.set(0, D.hold({ x: 0, y: 1 }, { x: 0, y: 1 }));
      D.set(1, D.hold({ x: 0, y: 1 }, { x: 0, y: 1 }));
    } else {
      // Side walls (world east / west faces of the 6 m wide bank), walking south.
      D.tp(D.charId(0), { x: nb.pos.x - 3 - 0.55, y: nb.pos.y + 1.2 }, 0);
      D.tp(D.charId(1), { x: nb.pos.x + 3 + 0.55, y: nb.pos.y + 1.0 }, Math.PI);
      D.set(0, D.hold({ x: -0.05, y: 1 }, { x: 1, y: 0 }));
      D.set(1, D.hold({ x: 0.05, y: 1 }, { x: -1, y: 0 }));
    }
    const n = D.sim.state.characters.length;
    if (n > 2) {
      D.tp(D.charId(2), D.freeNear({ x: fence.center.x + 6.5, y: fence.center.y + 7 }), Math.PI);
      D.set(2, D.idle({ x: -1, y: -1 }));
    }
    if (n > 3) {
      D.tp(D.charId(3), D.freeNear({ x: fence.center.x - 7, y: fence.center.y + 8 }), 0);
      D.set(3, D.idle({ x: 1, y: -1 }));
    }
    return { bankId: b.id, fenceId: fence.id };
  };

  /** Police chase: an uprooted bank rings its alarm; the player hauls a small safe past the car. */
  S.police = () => {
    const sim = D.sim;
    const L = sim.layout;
    const b = D.banks()[0];
    sim.debug.setAnchored(b.id, false);
    const safe = sim.state.loot.find((l) => l.kind === 'smallSafe' && l.homeBank === null && !l.recovered);
    sim.debug.setAnchored(safe.id, false);
    return { bankId: b.id, safeId: safe.id, layout: L.id };
  };

  /** Recovery of a whole bank at our van (max fanfare): player + teammate drag it in. */
  S.recover = () => {
    const sim = D.sim;
    const z = sim.layout.zones.find((zz) => zz.team === 0);
    const b = D.banks()[0];
    sim.debug.setAnchored(b.id, false);
    // Bank just east of the zone, rotated to fit; the gang pulls it west into the zone.
    D.tp(b.id, { x: z.center.x + 3.2, y: z.center.y }, Math.PI / 2);
    const nb = D.loot(b.id);
    D.tp(D.charId(0), { x: nb.pos.x - 3.55, y: nb.pos.y + 2.4 }, 0);
    D.tp(D.charId(1), { x: nb.pos.x - 3.55, y: nb.pos.y - 2.3 }, 0);
    D.set(0, D.hold({ x: -1, y: 0.1 }, { x: 1, y: 0 }));
    D.set(1, D.hold({ x: -1, y: -0.1 }, { x: 1, y: 0 }));
    const n = sim.state.characters.length;
    if (n > 2) {
      D.tp(D.charId(2), D.freeNear({ x: nb.pos.x + 9, y: nb.pos.y + 5 }), Math.PI);
      D.set(2, D.idle({ x: -1, y: 0 }));
    }
    if (n > 3) {
      D.tp(D.charId(3), D.freeNear({ x: nb.pos.x + 10, y: nb.pos.y - 4 }), Math.PI);
      D.set(3, D.idle({ x: -1, y: 0 }));
    }
    return { bankId: b.id };
  };

  /** Both banks dropped into the zones: recovered -> the final 30 s countdown with sirens. */
  S.final = () => {
    const sim = D.sim;
    const L = sim.layout;
    const [b0, b1] = D.banks();
    const z0 = L.zones.find((z) => z.team === 0);
    const z1 = L.zones.find((z) => z.team === 1) || z0;
    sim.debug.setAnchored(b0.id, false);
    D.tp(b0.id, z0.center, Math.PI / 2);
    sim.debug.setAnchored(b1.id, false);
    D.tp(b1.id, z1.center, Math.PI / 2);
    const n = sim.state.characters.length;
    for (let s = 0; s < n; s++) D.set(s, D.idle({ x: 0, y: 1 }));
    return { banks: [b0.id, b1.id] };
  };

  D.scenarios = S;
  D.cmd = cmd;
  window.__dir = D;
})();

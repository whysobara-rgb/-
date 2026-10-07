/**
 * Pushes team and loot colors from src/shared/teams.ts into CSS custom properties so the
 * stylesheets never hard-code them (single source of truth shared with render/minimap).
 */
import { LOOT_STYLE, TEAM_STYLES } from '../../shared/teams';

export function installTheme(target: HTMLElement = document.documentElement): void {
  const s = target.style;
  for (const id of [0, 1] as const) {
    const t = TEAM_STYLES[id];
    s.setProperty(`--uh-team${id}`, t.color);
    s.setProperty(`--uh-team${id}-tint`, t.tint);
    s.setProperty(`--uh-team${id}-dark`, t.dark);
  }
  s.setProperty('--uh-loot-small', LOOT_STYLE.smallSafe.color);
  s.setProperty('--uh-loot-small-dark', LOOT_STYLE.smallSafe.dark);
  s.setProperty('--uh-loot-large', LOOT_STYLE.largeSafe.color);
  s.setProperty('--uh-loot-large-dark', LOOT_STYLE.largeSafe.dark);
  s.setProperty('--uh-loot-bank', LOOT_STYLE.bank.color);
  s.setProperty('--uh-loot-bank-dark', LOOT_STYLE.bank.dark);
}

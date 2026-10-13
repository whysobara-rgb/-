/**
 * Shared team identity used by render, UI and minimap.
 * Teams are never distinguished by color alone (doc §13): each team also has an
 * emblem shape and a hat silhouette.
 */
import type { TeamId } from '../sim/types';

export interface TeamStyle {
  id: TeamId;
  /** i18n key for the team name. */
  nameKey: string;
  /** Emblem shape drawn on hats, backs, vans, zones, HUD and minimap. */
  emblem: 'star' | 'moon';
  /** Default hat silhouette. */
  hat: 'teamCapA' | 'teamCapB';
  /** Primary color (CSS hex). Orange/blue pair stays distinct for common color-vision deficiencies. */
  color: string;
  /** Lighter tint for backgrounds. */
  tint: string;
  /** Darker shade for outlines/text on light backgrounds. */
  dark: string;
}

export const TEAM_STYLES: Readonly<Record<TeamId, TeamStyle>> = {
  0: { id: 0, nameKey: 'team.star', emblem: 'star', hat: 'teamCapA', color: '#FF8A3D', tint: '#FFE3CC', dark: '#B4501A' },
  1: { id: 1, nameKey: 'team.moon', emblem: 'moon', hat: 'teamCapB', color: '#3D8BFF', tint: '#D6E6FF', dark: '#1D4FA6' },
};

/** Loot identity: shape + number, never color alone. */
export const LOOT_STYLE = {
  smallSafe: { color: '#7FB77E', dark: '#3F6E3E', icon: 'square' as const },
  largeSafe: { color: '#5B6BBF', dark: '#2E3A80', icon: 'wideRect' as const },
  bank: { color: '#F2C14E', dark: '#9C7413', icon: 'bank' as const },
};

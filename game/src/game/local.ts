/**
 * Local multiplayer ("같이 하기") — pure lobby state and match-shape rules (unit-tested).
 *
 *  - 1-4 players on one machine; each device (keyboard A / keyboard B / pad N) is one player.
 *  - A player joins with their grab button, gets the lowest free P-number (= colour), picks a
 *    team (left = star team 0, right = team 1), then readies up. Back un-readies, then leaves.
 *  - At most two humans per team. Humans on both teams = VERSUS; all on one team = CO-OP against
 *    a bot team. 1:1 is possible only while every team has at most one human; otherwise 2:2.
 *    Empty slots are bots.
 *  - The save owner is P1 (P-numbers are stable while a player stays joined).
 */
import type { TeamId } from '../sim/types';
import type { LocalDeviceId } from '../platform/localInput';
import type { MatchMode } from './setup';

export const MAX_LOCAL_PLAYERS = 4;
export const MAX_HUMANS_PER_TEAM = 2;

/** P1..P4 colours (ring, tag, chip, offscreen arrow). Distinct from both team colours' hue families and readable on the map. */
export const PLAYER_COLORS: readonly string[] = ['#ff7a3d', '#3db8ff', '#9be04a', '#c77dff'];
/** Darker partner shade for outlines / text on light chips. */
export const PLAYER_INK: readonly string[] = ['#a8410f', '#0d6aa0', '#4f8a14', '#7337a8'];

export type LocalStyle = 'versus' | 'coop';

export interface LobbyPlayer {
  device: LocalDeviceId;
  /** 0..3 -> "P1".."P4" and the colour. */
  index: number;
  team: TeamId;
  ready: boolean;
}

export interface LobbyState {
  players: LobbyPlayer[];
}

export function emptyLobby(): LobbyState {
  return { players: [] };
}

export function playerOf(s: LobbyState, device: LocalDeviceId): LobbyPlayer | null {
  return s.players.find((p) => p.device === device) ?? null;
}

export function humansOnTeam(s: LobbyState, team: TeamId, except?: LocalDeviceId): number {
  return s.players.filter((p) => p.team === team && p.device !== except).length;
}

/** Join: lowest free P-number, team with room (fewer humans first; ties -> left). Null when full / already in. */
export function join(s: LobbyState, device: LocalDeviceId): LobbyState | null {
  if (playerOf(s, device) || s.players.length >= MAX_LOCAL_PLAYERS) return null;
  let index = 0;
  while (s.players.some((p) => p.index === index)) index++;
  const t0 = humansOnTeam(s, 0);
  const t1 = humansOnTeam(s, 1);
  // P1 starts left; the next ones balance the teams (versus is the party default).
  const team: TeamId = t0 <= t1 ? (t0 < MAX_HUMANS_PER_TEAM ? 0 : 1) : t1 < MAX_HUMANS_PER_TEAM ? 1 : 0;
  const players = [...s.players, { device, index, team, ready: false }].sort((a, b) => a.index - b.index);
  return { players };
}

export function leave(s: LobbyState, device: LocalDeviceId): LobbyState {
  return { players: s.players.filter((p) => p.device !== device) };
}

/** Move to a team when it has room (ready players stay put). */
export function setTeam(s: LobbyState, device: LocalDeviceId, team: TeamId): LobbyState {
  const p = playerOf(s, device);
  if (!p || p.ready || p.team === team) return s;
  if (humansOnTeam(s, team, device) >= MAX_HUMANS_PER_TEAM) return s;
  return { players: s.players.map((q) => (q.device === device ? { ...q, team } : q)) };
}

export function setReady(s: LobbyState, device: LocalDeviceId, ready: boolean): LobbyState {
  if (!playerOf(s, device)) return s;
  return { players: s.players.map((q) => (q.device === device ? { ...q, ready } : q)) };
}

export type LobbyAction = 'confirm' | 'back' | 'left' | 'right';

export interface LobbyStep {
  state: LobbyState;
  /** What happened (UI sound / animation). */
  event: 'joined' | 'left' | 'team' | 'ready' | 'unready' | 'blocked' | 'exit' | null;
}

/**
 * One device's join-screen press: confirm joins, then readies; back un-readies, then leaves (and
 * from a device that is not in, with nobody in, exits the screen); left / right pick the team.
 */
export function lobbyStep(s: LobbyState, device: LocalDeviceId, action: LobbyAction): LobbyStep {
  const p = playerOf(s, device);
  if (action === 'confirm') {
    if (!p) {
      const j = join(s, device);
      return j ? { state: j, event: 'joined' } : { state: s, event: 'blocked' };
    }
    if (p.ready) return { state: s, event: null };
    return { state: setReady(s, device, true), event: 'ready' };
  }
  if (action === 'back') {
    if (!p) return { state: s, event: s.players.length ? null : 'exit' };
    if (p.ready) return { state: setReady(s, device, false), event: 'unready' };
    return { state: leave(s, device), event: 'left' };
  }
  if (!p || p.ready) return { state: s, event: null };
  const team: TeamId = action === 'left' ? 0 : 1;
  if (p.team === team) return { state: s, event: null };
  const n = setTeam(s, device, team);
  return n === s ? { state: s, event: 'blocked' } : { state: n, event: 'team' };
}

export function lobbyStyle(s: LobbyState): LocalStyle {
  return humansOnTeam(s, 0) > 0 && humansOnTeam(s, 1) > 0 ? 'versus' : 'coop';
}

/** Match sizes this lobby can play (2:2 whenever a team has two humans). */
export function allowedModes(s: LobbyState): MatchMode[] {
  return humansOnTeam(s, 0) > 1 || humansOnTeam(s, 1) > 1 ? ['2v2'] : ['1v1', '2v2'];
}

/** Everyone joined is ready (and at least one player). */
export function allReady(s: LobbyState): boolean {
  return s.players.length > 0 && s.players.every((p) => p.ready);
}

/** The lobby's mode, given the last choice (falls back to the first allowed). */
export function resolveMode(s: LobbyState, wanted: MatchMode): MatchMode {
  const m = allowedModes(s);
  if (m.includes(wanted)) return wanted;
  return m[0]!;
}

/** One human seat of a local match (MatchConfig.local). */
export interface LocalSeat {
  device: LocalDeviceId;
  /** 0..3 = P1..P4. */
  index: number;
  team: TeamId;
}

export interface LocalMatchSetup {
  seats: LocalSeat[];
  style: LocalStyle;
}

export function localSetupFromLobby(s: LobbyState): LocalMatchSetup {
  const seats = [...s.players].sort((a, b) => a.index - b.index).map((p) => ({ device: p.device, index: p.index, team: p.team }));
  return { seats, style: lobbyStyle(s) };
}

/** Readable player tag. */
export function playerTag(index: number): string {
  return `P${index + 1}`;
}

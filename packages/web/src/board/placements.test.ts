/**
 * placements 反推测试：
 * - 以 rng 局为真值来源（引擎侧 preset 推导逻辑同款），回填 preset 开后，
 *   computePlacements 应精确恢复每个标准扇区的 center/rotation；
 * - 深空三角板：side 的面内容与实格逐格美术等价，artPlanet 覆盖每格；
 * - 盖亚转化（transdim→gaia）/失落星球（empty→lost）后仍能恢复摆放，
 *   且 artPlanet 记录的是原画内容。
 */
import { describe, expect, it } from 'vitest';
import {
  hexAdd,
  hexKey,
  newGame,
  parseHexKey,
  rotateRight,
  SECTOR_POSITIONS,
  SECTORS,
} from '@gaia/engine';
import type { GameState, Hex, HexKey, SetupPreset, TechTilePosition } from '@gaia/engine';
import { computePlacements } from './placements';

/** 与引擎 preset.test 同款的 setup 结果反推（真值）。 */
function presetFromState(state: GameState): SetupPreset {
  const bySector = new Map<string, HexKey[]>();
  for (const [key, hex] of Object.entries(state.map) as [HexKey, (typeof state.map)[HexKey]][]) {
    const list = bySector.get(hex.sector) ?? [];
    list.push(key);
    bySector.set(hex.sector, list);
  }
  const sectors: SetupPreset['map']['sectors'] = [];
  for (const [id, keys] of bySector) {
    if (id === 'interspace' || state.map[keys[0]!]?.deepSpace === true) continue;
    const centerKey = keys.find((k) =>
      keys.every((k2) => {
        const h = parseHexKey(k);
        const d = parseHexKey(k2);
        return Math.max(Math.abs(h.q - d.q), Math.abs(h.r - d.r), Math.abs(h.q - d.q + h.r - d.r)) <= 2;
      }),
    )!;
    const center = parseHexKey(centerKey);
    const def = SECTORS[id as keyof typeof SECTORS]!;
    let rotation = -1;
    for (let r = 0; r < 6; r++) {
      const ok = SECTOR_POSITIONS.every((rel, i) => {
        const abs = rotateRight(hexAdd(rel, center), center, r);
        const hex = state.map[hexKey(abs)];
        return hex !== undefined && hex.sector === id && hex.planet === def.layout[i];
      });
      if (ok) {
        rotation = r;
        break;
      }
    }
    expect(rotation, `扇区 ${id} 旋转`).toBeGreaterThanOrEqual(0);
    sectors.push({ id, rotation, center: center as Hex });
  }
  const preset: SetupPreset = {
    map: { sectors },
    roundScoring: [...state.board.roundScoring],
    finalScoring: [...state.board.finalScoring],
    advTechTiles: state.board.advTechTiles.map((t) => t!),
    techTilePositions: { ...state.board.techTilePositions } as Record<TechTilePosition, SetupPreset['techTilePositions'][TechTilePosition]>,
    boosters: [...state.board.boosters],
    terraformingL5Token: state.board.terraformingL5Token!,
  };
  if (state.config.lostFleet) {
    const interspace: NonNullable<SetupPreset['lostFleet']>['interspace'] = [];
    const deepSpace: NonNullable<SetupPreset['lostFleet']>['deepSpace'] = [];
    for (const [key, hex] of Object.entries(state.map) as [HexKey, (typeof state.map)[HexKey]][]) {
      if (hex.sector === 'interspace') {
        interspace.push({ hex: key, planet: hex.planet, ...(hex.ship !== undefined ? { ship: hex.ship } : {}) });
      } else if (hex.deepSpace) {
        deepSpace.push({ hex: key, planet: hex.planet, tile: Number(hex.sector) });
      }
    }
    preset.lostFleet = {
      interspace,
      deepSpace,
      ships: state.board.ships.map((s) => ({
        id: s.id,
        hex: s.hex,
        techTile: s.techTiles[0] ?? null,
        federationToken: s.federationToken,
        artifacts: s.artifacts.map((a) => a.id),
      })),
      economyOverlay: state.board.economyOverlay ?? 'pw',
      scoringExtension: state.board.scoringExtension ?? 'vp',
    };
  }
  return preset;
}

function fixturePresetGame(): { state: GameState; preset: SetupPreset } {
  const rngGame = newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
  });
  const preset = presetFromState(rngGame);
  const state = newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
    preset,
  });
  return { state, preset };
}

describe('computePlacements 标准扇区', () => {
  it('精确恢复 preset 的 center/rotation（4 人 LF 图 10 块）', () => {
    const { state, preset } = fixturePresetGame();
    const placements = computePlacements(state.map);
    expect(placements.sectors).toHaveLength(preset.map.sectors.length);
    const truth = new Map(preset.map.sectors.map((s) => [s.id, s]));
    for (const p of placements.sectors) {
      const t = truth.get(p.id);
      expect(t, `扇区 ${p.id}`).toBeDefined();
      expect(p.center).toEqual(t!.center);
      expect(p.rotation, `扇区 ${p.id} 旋转`).toBe(t!.rotation);
    }
  });

  it('artPlanet 覆盖全部标准扇区格且等于 layout 原画', () => {
    const { state } = fixturePresetGame();
    const placements = computePlacements(state.map);
    for (const p of placements.sectors) {
      const def = SECTORS[p.id as keyof typeof SECTORS]!;
      for (let j = 0; j < SECTOR_POSITIONS.length; j++) {
        const abs = rotateRight(hexAdd(SECTOR_POSITIONS[j]!, p.center), p.center, p.rotation);
        expect(placements.artPlanet.get(hexKey(abs))).toBe(def.layout[j]);
      }
    }
  });
});

describe('computePlacements 深空三角板', () => {
  it('每块深空板判定出 side，且 artPlanet 与实格内容一致', () => {
    const { state } = fixturePresetGame();
    const placements = computePlacements(state.map);
    const deepKeys = (Object.keys(state.map) as HexKey[]).filter((k) => state.map[k]!.deepSpace);
    expect(deepKeys.length).toBeGreaterThan(0);
    // 4 人局 8 块深空板
    expect(placements.deepSpace).toHaveLength(8);
    for (const k of deepKeys) {
      // 深空格内容不会被转化（无 transdim→gaia 的例外需走美术等价，但新局无转化）
      expect(placements.artPlanet.get(k), `深空格 ${k}`).toBe(state.map[k]!.planet);
    }
    for (const d of placements.deepSpace) {
      expect(d.tile).toBeGreaterThanOrEqual(11);
      expect(d.tile).toBeLessThanOrEqual(18);
      expect(['a', 'b']).toContain(d.side);
      expect(d.rotation).toBeGreaterThanOrEqual(0);
      expect(d.rotation).toBeLessThan(6);
    }
  });
});

describe('computePlacements 美术等价（转化后）', () => {
  it('transdim→gaia、empty→lost 后仍恢复摆放，artPlanet 记原画', () => {
    const { state } = fixturePresetGame();
    // 手工改造：一个 transdim 格变 gaia（盖亚计划完成），一个空格变 lost
    const transdimKey = (Object.keys(state.map) as HexKey[]).find(
      (k) => state.map[k]!.planet === 'transdim' && !state.map[k]!.deepSpace && state.map[k]!.sector !== 'interspace',
    )!;
    const emptyKey = (Object.keys(state.map) as HexKey[]).find(
      (k) =>
        state.map[k]!.planet === 'empty' &&
        !state.map[k]!.deepSpace &&
        state.map[k]!.sector !== 'interspace' &&
        state.map[k]!.ship === undefined,
    )!;
    state.map[transdimKey] = { ...state.map[transdimKey]!, planet: 'gaia' };
    state.map[emptyKey] = { ...state.map[emptyKey]!, planet: 'lost' };

    const before = computePlacements(state.map);
    expect(before.sectors).toHaveLength(10);
    // 转化格：artPlanet 仍为原画 transdim / empty
    expect(before.artPlanet.get(transdimKey)).toBe('transdim');
    expect(before.artPlanet.get(emptyKey)).toBe('empty');
  });
});

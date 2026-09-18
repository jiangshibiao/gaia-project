/**
 * GameConfig.preset 测试：rng 抽出的 setup 结果回填为 preset 后，
 * newGame 产物与 rng 版一致（除 rngState——preset 路径不消耗抽签流）。
 */
import { describe, expect, it } from 'vitest';
import {
  hexAdd,
  hexKey,
  IllegalActionError,
  newGame,
  parseHexKey,
  rotateRight,
  SECTOR_POSITIONS,
  SECTORS,
  stableStringify,
  type GameConfig,
  type GameState,
  type Hex,
  type SetupPreset,
  type TechTilePosition,
} from '../src/index.js';

/** 从 rng 生成的标准局状态反推 preset（地图扇区中心/旋转按布局匹配恢复）。 */
function presetFromState(state: GameState): SetupPreset {
  // 按扇区分组，中心 = 6 个邻格全在同扇区的 hex。
  const bySector = new Map<string, string[]>();
  for (const [key, hex] of Object.entries(state.map)) {
    const list = bySector.get(hex.sector) ?? [];
    list.push(key);
    bySector.set(hex.sector, list);
  }
  const sectors: SetupPreset['map']['sectors'] = [];
  for (const [id, keys] of bySector) {
    // LF 的 interspace（sector='interspace'）与深空扇区（sector=板号）不是
    // 19 格标准扇区，跳过（内容由 lostFleet.interspace/deepSpace 覆盖）。
    if (id === 'interspace' || state.map[keys[0] as `${number},${number}`]?.deepSpace === true) {
      continue;
    }
    // 中心 = 全扇区 19 格都在其 2 格范围内的唯一 hex（B 环格到对边 A 环距离为 3）。
    const centerKey = keys.find((k) => {
      const h = parseHexKey(k as `${number},${number}`);
      return keys.every((k2) => {
        const d = parseHexKey(k2 as `${number},${number}`);
        const dq = h.q - d.q;
        const dr = h.r - d.r;
        return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr)) <= 2;
      });
    });
    expect(centerKey, `扇区 ${id} 中心`).toBeDefined();
    const center = parseHexKey(centerKey as `${number},${number}`);
    const def = SECTORS[id as keyof typeof SECTORS];
    expect(def, `扇区 ${id} 定义`).toBeDefined();
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
    advTechTiles: state.board.advTechTiles.map((t) => {
      expect(t).not.toBeNull();
      return t!;
    }),
    techTilePositions: { ...state.board.techTilePositions } as Record<TechTilePosition, SetupPreset['techTilePositions'][TechTilePosition]>,
    boosters: [...state.board.boosters],
    terraformingL5Token: state.board.terraformingL5Token!,
  };
  if (state.config.lostFleet) {
    const interspace: NonNullable<SetupPreset['lostFleet']>['interspace'] = [];
    const deepSpace: NonNullable<SetupPreset['lostFleet']>['deepSpace'] = [];
    for (const [key, hex] of Object.entries(state.map)) {
      if (hex.sector === 'interspace') {
        interspace.push({ hex: key as `${number},${number}`, planet: hex.planet, ...(hex.ship !== undefined ? { ship: hex.ship } : {}) });
      } else if (hex.deepSpace) {
        deepSpace.push({ hex: key as `${number},${number}`, planet: hex.planet, tile: Number(hex.sector) });
      }
    }
    const terraformThreeStep: NonNullable<SetupPreset['lostFleet']>['terraformThreeStep'] = {};
    for (const p of state.players) {
      if (p.terraformThreeStep.length > 0) {
        terraformThreeStep[p.faction] = [...p.terraformThreeStep];
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
      economyOverlay: state.board.economyOverlay!,
      scoringExtension: state.board.scoringExtension!,
      terraformThreeStep,
    };
  }
  return preset;
}

const CONFIGS: GameConfig[] = [
  { playerCount: 3, seed: 7, factions: ['baltaks', 'bescods', 'ambas'], lostFleet: false },
  { playerCount: 4, seed: 11, factions: ['taklons', 'xenos', 'terrans', 'baltaks'], lostFleet: false },
  { playerCount: 2, seed: 3, factions: ['terrans', 'itars'], lostFleet: false },
  // Lost Fleet：覆盖 4 新族中的 3 个（tinkeroids/moweyds/darkanians）与两种扩展条面。
  { playerCount: 4, seed: 5, factions: ['tinkeroids', 'moweyds', 'baltaks', 'taklons'], lostFleet: true },
  { playerCount: 4, seed: 13, factions: ['darkanians', 'space-giants', 'gleens', 'nevlas'], lostFleet: true },
  { playerCount: 3, seed: 17, factions: ['tinkeroids', 'geodens', 'ivits'], lostFleet: true },
  { playerCount: 2, seed: 23, factions: ['moweyds', 'itars'], lostFleet: true },
];

describe('preset 回填一致性', () => {
  for (const config of CONFIGS) {
    it(`${config.playerCount} 人局 seed=${config.seed} LF=${config.lostFleet ?? true}：rng 结果回填 preset 后状态一致（除 rngState）`, () => {
      const rngGame = newGame(config);
      const preset = presetFromState(rngGame);
      const presetGame = newGame({ ...config, preset });
      // rngState 必然不同（preset 路径不消耗抽签流），剔除后逐字节一致。
      expect(stableStringify({ ...presetGame, rngState: 0 })).toBe(
        stableStringify({ ...rngGame, rngState: 0 }),
      );
    });
  }

  it('不带 preset 时行为不变（同 config 两次一致）', () => {
    const a = newGame(CONFIGS[0]!);
    const b = newGame(CONFIGS[0]!);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('Lost Fleet preset 缺 lostFleet 部分时报错', () => {
    const std = newGame(CONFIGS[0]!);
    const preset = presetFromState(std);
    expect(() => newGame({ ...CONFIGS[0]!, lostFleet: true, preset })).toThrow(IllegalActionError);
  });
});

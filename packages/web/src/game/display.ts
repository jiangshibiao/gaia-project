/**
 * 中文文案与配色映射（M2c）：行动/板块/种族/星球/飞船一句话描述。
 * 引擎数据表已有部分中文名（科技板/计分板/助推器/研究轨/星球），直接复用；
 * 联邦标记/行动格/飞船行动等由数据表字段组合生成。
 */
import {
  ADV_TECH_TILES,
  BOARD_ACTIONS,
  BOOSTERS,
  FACTIONS,
  FEDERATION_TOKENS,
  FINAL_SCORING,
  FREE_CONVERSIONS,
  PLANET_NAMES,
  RESEARCH_TRACKS,
  ROUND_SCORING,
  TECH_TILES,
  TINKERING_TILES,
} from '@gaia/engine';
import type {
  Action,
  AdvTechTileId,
  ArtifactId,
  BoardActionId,
  BoosterId,
  BuildingType,
  FactionId,
  FederationTokenId,
  FreeConversionId,
  PlanetType,
  PlayerIndex,
  ResearchTrack,
  ResourceGain,
  ShipActionId,
  ShipId,
  SpecialActionId,
  TechTileId,
} from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';

// ---------------------------------------------------------------------------
// 种族与玩家色
// ---------------------------------------------------------------------------

/** 种族中文名（BGA 官方中文帮助文档/桌游圈/发行方商品文案多源一致的标准译名）。 */
export const FACTION_ZH: Record<FactionId, string> = {
  terrans: '人类',
  lantids: '亚特兰斯星人',
  xenos: '异空族',
  gleens: '格伦星人',
  taklons: '利爪族',
  ambas: '大使星人',
  'hadsch-hallas': '圣禽族',
  ivits: '蜂人',
  geodens: '晶矿星人',
  baltaks: '炽炎族',
  firaks: '章鱼人',
  bescods: '疯狂机器',
  nevlas: '超星人',
  itars: '伊塔星人',
  tinkeroids: '焊修智械',
  darkanians: '暗黑星人',
  moweyds: '莫维兹星人',
  'space-giants': '太空巨人',
};

export function factionName(id: FactionId): string {
  return FACTION_ZH[id] ?? id;
}

/** 族色 → 展示用 hex（官方 7 色 + LF 粉/青）。 */
export const FACTION_COLOR_HEX: Record<string, string> = {
  blue: '#3d7bd6',
  yellow: '#e0b92e',
  brown: '#8a5a35',
  red: '#cf4444',
  orange: '#e07b2a',
  gray: '#9aa2ab',
  white: '#e8ecf0',
  pink: '#e06fb0',
  turquoise: '#35b8b2',
};

/** 座位玩家色（由其种族族色决定；未知座位给中性灰）。 */
export function playerColor(state: FilteredState, idx: PlayerIndex): string {
  const faction = state.players[idx]?.faction;
  if (faction === undefined) return '#7f8c8d';
  return FACTION_COLOR_HEX[FACTIONS[faction].color] ?? '#7f8c8d';
}

// ---------------------------------------------------------------------------
// 星球与建筑
// ---------------------------------------------------------------------------

/** 星球类型配色（7 母星 + gaia 绿 / transdim 紫 / asteroid 碎石 / proto 发光 / lost 特殊）。 */
export const PLANET_COLORS: Record<PlanetType, string> = {
  terra: '#2e6fd8',
  desert: '#d9b13b',
  swamp: '#7d5a33',
  oxide: '#c23c3c',
  volcanic: '#d4692b',
  titanium: '#8f959c',
  ice: '#e6edf5',
  gaia: '#3fae5a',
  transdim: '#7b4fc9',
  asteroid: '#6e7278',
  proto: '#c8d96a',
  lost: '#2a9d8f',
  empty: 'transparent',
};

export function planetName(t: PlanetType): string {
  return PLANET_NAMES[t] ?? t;
}

export const BUILDING_ZH: Record<BuildingType, string> = {
  mine: '矿井',
  ts: '贸易站',
  lab: '实验室',
  pi: '行星研究院',
  ac1: '学院·知识',
  ac2: '学院·QIC',
  gf: '盖亚形成器',
  sp: '空间站',
};

export function buildingName(t: BuildingType): string {
  return BUILDING_ZH[t] ?? t;
}

// ---------------------------------------------------------------------------
// 板块与轨道名称（复用引擎数据表）
// ---------------------------------------------------------------------------

export function techTileName(id: TechTileId): string {
  return TECH_TILES[id]?.name ?? id;
}

export function advTechTileName(id: AdvTechTileId): string {
  return ADV_TECH_TILES[id]?.name ?? id;
}

export function trackName(t: ResearchTrack): string {
  return RESEARCH_TRACKS[t]?.name ?? t;
}

export function boosterName(id: BoosterId): string {
  return BOOSTERS[id]?.name ?? id;
}

export function roundScoringName(id: string): string {
  return ROUND_SCORING[id as keyof typeof ROUND_SCORING]?.name ?? id;
}

export function finalScoringName(id: string): string {
  return FINAL_SCORING[id as keyof typeof FINAL_SCORING]?.name ?? id;
}

export function tinkeringName(id: string): string {
  return TINKERING_TILES[id as keyof typeof TINKERING_TILES]?.name ?? id;
}

/** 联邦标记一句话（vp + 即时奖励/效果）。 */
export function federationTokenName(id: FederationTokenId): string {
  const def = FEDERATION_TOKENS[id];
  if (def === undefined) return id;
  const parts: string[] = [];
  if (def.vp > 0) parts.push(`${def.vp} 分`);
  if (def.other !== undefined) parts.push(formatGain(def.other));
  switch (def.immediate) {
    case 'tech-tile':
      parts.push('立即拿科技板');
      break;
    case 'free-mine-unlimited-range':
      parts.push('免费建矿（无限射程）');
      break;
    case 'free-mine-3-steps':
      parts.push('免费建矿（3 免费步）');
      break;
    case 'power-tokens-bowl3':
      parts.push('2 能量标记直入 III 区');
      break;
    default:
      break;
  }
  return parts.join(' + ') || id;
}

// ---------------------------------------------------------------------------
// 资源/奖励格式化
// ---------------------------------------------------------------------------

/** 紧凑资源文案：1 矿 / 2 币 / 1 知 / 1Q / 3 分 / 充能 2 / 1 能量标记 / 1 盖亚形成器。 */
export function formatGain(g: ResourceGain): string {
  const parts: string[] = [];
  if (g.ore !== undefined) parts.push(`${g.ore} 矿`);
  if (g.credits !== undefined) parts.push(`${g.credits} 币`);
  if (g.knowledge !== undefined) parts.push(`${g.knowledge} 知`);
  if (g.qic !== undefined) parts.push(`${g.qic}Q`);
  if (g.vp !== undefined) parts.push(`${g.vp} 分`);
  if (g.chargePower !== undefined) parts.push(`充能 ${g.chargePower}`);
  if (g.powerToken !== undefined) parts.push(`${g.powerToken} 能量标记`);
  if (g.gaiaformer !== undefined) parts.push(`${g.gaiaformer} 盖亚形成器`);
  return parts.join('+');
}

// ---------------------------------------------------------------------------
// 行动格与各类行动文案
// ---------------------------------------------------------------------------

/** 研究板 power/qic 行动格文案（费用→效果）。 */
export function boardActionLabel(id: BoardActionId): string {
  const def = BOARD_ACTIONS[id];
  if (def === undefined) return id;
  const cost = def.cost.power !== undefined ? `${def.cost.power} 能` : `${def.cost.qic}Q`;
  let effect: string;
  switch (def.effect.kind) {
    case 'gain':
      effect = formatGain(def.effect.gain);
      break;
    case 'build-mine':
      effect = `建矿（${def.effect.freeTerraformSteps} 免费步）`;
      break;
    case 'gain-tech-tile':
      effect = '拿 1 科技板';
      break;
    case 'rescore-federation':
      effect = '重结算联邦标记';
      break;
    case 'vp-per-planet-type':
      effect = `${def.effect.base} 分+每星球类型 ${def.effect.perType} 分`;
      break;
    default:
      effect = id;
  }
  return `${cost} → ${effect}`;
}

/** 免费兑换文案（费用→收益）。 */
export function conversionLabel(id: FreeConversionId): string {
  const def = FREE_CONVERSIONS[id];
  if (def === undefined) return id;
  const costParts: string[] = [];
  const c = def.cost;
  if (c.power !== undefined) costParts.push(`${c.power} 能`);
  if (c.gaiaPower !== undefined) costParts.push(`盖亚区 ${c.gaiaPower} 能`);
  if (c.ore !== undefined) costParts.push(`${c.ore} 矿`);
  if (c.credits !== undefined) costParts.push(`${c.credits} 币`);
  if (c.knowledge !== undefined) costParts.push(`${c.knowledge} 知`);
  if (c.qic !== undefined) costParts.push(`${c.qic}Q`);
  if (c.gaiaformer !== undefined) costParts.push('1 盖亚形成器');
  if (c.powerTokenFromBowl3 !== undefined) costParts.push('III 区 1 能量标记');
  return `${costParts.join('+')} → ${formatGain(def.gain)}`;
}

export const SPECIAL_ACTION_ZH: Record<SpecialActionId, string> = {
  tech9: '充能 4 能量（科技板）',
  advtech3: '+1Q+5 币（高级板）',
  advtech11: '+3 矿（高级板）',
  advtech13: '+3 知（高级板）',
  booster4: '建矿（1 免费步，助推器）',
  booster5: '建矿/盖亚计划 射程+3（助推器）',
  boosterlf4: '免费立即盖亚计划（助推器）',
  ac2: 'QIC 学院：+1Q',
  'ivits-sp': '放置空间站（蜂人）',
  'ambas-swap': '交换 PI 与矿井（大使星人）',
  'firaks-down': '实验室降级推进研究（章鱼人）',
  'bescods-up': '推进最低研究轨（疯狂机器）',
  'gleens-range': '射程 +2（格伦星人探索板）',
  'moweyds-ring': '放置能量环（莫维兹星人）',
  'tinkeroids-tile': '使用本轮修补板块（焊修智械）',
  'space-giants-mine': '建矿（2 免费步，太空巨人）',
};

export function specialActionLabel(id: SpecialActionId): string {
  return SPECIAL_ACTION_ZH[id] ?? id;
}

export const SHIP_ZH: Record<ShipId, string> = {
  twilight: '暮光号',
  rebellion: '叛乱号',
  tfmars: 'T.F.火星号',
  eclipse: '日蚀号',
};

export function shipName(id: ShipId): string {
  return SHIP_ZH[id] ?? id;
}

export const SHIP_ACTION_ZH: Record<ShipActionId, string> = {
  'ship-rescore-fed': '3Q → 重触发联邦标记',
  'ship-upgrade-ts-lab': '3 能+2 矿 → 免费升贸易站→实验室',
  'ship-range3': '1 知 → 射程 +3',
  'ship-tech-tile': '3Q → 拿 1 科技板（可拿船上）',
  'ship-upgrade-mine-ts': '3 能+1 矿 → 免费升矿井→贸易站',
  'ship-2c1q': '2 知 → +2 币+1Q',
  'ship-vp-per-tech': '2Q → 2 分+每标准科技板 1 分',
  'ship-instant-gaia': '2 能 → 立即盖亚转化',
  'ship-terraform-step': '3 币 → 1 terraform 步建矿',
  'ship-vp-per-planet': '2Q → 2 分+每星球类型 1 分',
  'ship-research': '3 能+2 知 → 任意轨升 1 级',
  'ship-asteroid-mine': '6 币 → 小行星免费建矿',
};

export function shipActionLabel(id: ShipActionId): string {
  return SHIP_ACTION_ZH[id] ?? id;
}

export const ARTIFACT_ZH: Record<ArtifactId, string> = {
  'art-1k1o': '收入 +1 知+1 矿',
  'art-3c3o': '一次性 +3 币+3 矿',
  'art-3k1q': '一次性 +3 知+1Q',
  'art-5c2o': '一次性 +5 币+2 矿',
  'art-asteroid': '+7 分（视作小行星矿）',
  'art-proto': '+7 分（视作原行星矿）',
  'art-sci': '科学轨每级 +3 分',
  'art-gaia': '盖亚轨每级 +3 分',
  'art-track': '每条 ≥L3 轨 +3 分',
  'art-planet': '+3 分+每星球类型 1 分',
  'art-deep': '每深空扇区 +3 分',
  'art-fed': '重触发 1 枚联邦标记',
  'art-pwt': '收入 2 能量标记直入 III 区',
};

export function artifactName(id: ArtifactId): string {
  return ARTIFACT_ZH[id] ?? id;
}

// ---------------------------------------------------------------------------
// 行动一句话描述（日志 / 候选列表）
// ---------------------------------------------------------------------------

export function describeAction(action: Action): string {
  switch (action.type) {
    case 'build-mine':
      return `建矿 @${action.hex}`;
    case 'start-gaia-project':
      return `启动盖亚计划 @${action.hex}`;
    case 'upgrade': {
      let s = `升级 @${action.hex} → ${buildingName(action.to)}`;
      if (action.advTechTile !== undefined) s += `，拿高级板「${advTechTileName(action.advTechTile)}」`;
      else if (action.techTile !== undefined && action.techTile !== null) s += `，拿板「${techTileName(action.techTile)}」`;
      if (action.research !== undefined && action.research !== null) s += `，推进${trackName(action.research)}`;
      return s;
    }
    case 'form-federation':
      return `组建联邦（${action.hexes.length} 星球+${action.satellites.length} 卫星）→ ${federationTokenName(action.token)}`;
    case 'research': {
      let s = `研究推进 ${trackName(action.track)}`;
      if (action.hex !== undefined) s += `，放置失落星球 @${action.hex}`;
      return s;
    }
    case 'power-action':
      return `充能行动：${boardActionLabel(action.action)}`;
    case 'qic-action':
      return `QIC 行动：${boardActionLabel(action.action)}`;
    case 'special-action':
      return `特殊行动：${specialActionLabel(action.action)}`;
    case 'ship-action':
      return `飞船行动（${shipName(action.ship)}）：${shipActionLabel(action.action)}`;
    case 'explore-ship':
      return `探索飞船 ${shipName(action.ship)}`;
    case 'inspect-artifact':
      return `检视神器：${artifactName(action.artifact)}`;
    case 'pass':
      return action.booster !== null ? `Pass（换助推器「${boosterName(action.booster)}」）` : 'Pass';
    case 'free-conversion':
      return `兑换：${conversionLabel(action.conversion)}`;
    case 'burn':
      return '烧脑（II 区弃 1 能量，III 区能量 1 当 2）';
    case 'place-initial-mine':
      return `放置起始矿 @${action.hex}`;
    case 'choose-booster':
      return `选择起始助推器「${boosterName(action.booster)}」`;
    case 'charge':
      return '接受充能';
    case 'decline-charge':
      return '放弃充能';
    case 'itars-gaia-tech':
      return action.techTile !== null
        ? `伊塔星人盖亚阶段：弃 4 能拿板「${techTileName(action.techTile)}」`
        : '伊塔星人盖亚阶段：结束';
    case 'terrans-gaia-done':
      return '人类盖亚阶段：结束兑换';
    case 'choose-tinkering':
      return `选择修补板块「${tinkeringName(action.tile)}」`;
    case 'gain-tech-tile':
      return action.techTile !== null
        ? `拿科技板「${techTileName(action.techTile)}」`
        : action.advTechTile !== undefined
          ? `拿高级板「${advTechTileName(action.advTechTile)}」`
          : '放弃拿科技板';
    case 'free-mine':
      return action.hex !== null ? `免费建矿 @${action.hex}` : '跳过免费建矿';
    default:
      return (action as { type: string }).type;
  }
}

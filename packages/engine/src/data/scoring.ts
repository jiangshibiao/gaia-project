/**
 * 计分板数据：回合计分 10 基础 + 3 LF；终局计分 6 基础 + 3 LF。
 * 数据核对：reference/gaia-engine/src/tiles/scoring.ts（基础）+
 * reference/lost-fleet-rules.txt Appendix IV（LF）。
 *
 * 回合计分：setup 时洗 6 张按轮放置，每轮结束按该轮板结算（触发类，行动中即得）。
 * 终局计分：setup 时抽 2 张，终局按排名 18/12/6/0 vp（平分共享名次 vp 之和均分）；
 * 1–2 人局每张板有中立占位卫星（neutralValue = 占位轨位）。
 */
import type { FinalTileId, ScoringTileId } from '../types.js';

/** 回合计分触发时机。 */
export type RoundScoringTrigger =
  | 'terraform-step' // 每付费 terraform 步
  | 'research' // 每次研究推进
  | 'build-mine' // 每次建矿
  | 'form-federation' // 每次组建联邦（拿联邦标记）
  | 'upgrade-ts' // 每次升级贸易站
  | 'build-mine-gaia' // 每次在 Gaia 星球建矿
  | 'upgrade-pi-academy' // 每次升级 PI/学院
  | 'build-mine-new-sector' // LF：首次在之前未殖民的 Space/Deep Space 扇区建矿
  | 'build-mine-new-planet-type' // LF：首次在之前未殖民的星球类型建矿
  | 'build-lab'; // LF：每次建实验室

export interface RoundScoringDef {
  id: ScoringTileId;
  name: string;
  trigger: { on: RoundScoringTrigger; vp: number };
  lostFleet?: boolean;
}

/** 终局计分条件。 */
export type FinalCondition =
  | 'structure' // 建筑总数最多
  | 'structure-fed' // 联邦内建筑最多
  | 'planet-type' // 殖民星球类型最多（含 Gaia/Lost；LF 修订符号含 asteroid/proto 共 11 种）
  | 'gaia' // Gaia 星球最多
  | 'sector' // 有建筑的扇区最多
  | 'satellite' // 卫星最多（含 Ivits 空间站）
  | 'asteroid' // LF：殖民小行星最多
  | 'deep-space' // LF：殖民深空扇区最多（Lost Planet 算）
  | 'pi-academy-distance'; // LF：PI 与学院距离最远（缺任一不得分）

export interface FinalScoringDef {
  id: FinalTileId;
  name: string;
  condition: FinalCondition;
  /** 1–2 人局中立占位卫星的轨位；null = 【未确认】（LF 板数值规则书文本层无）。 */
  neutralValue: number | null;
  lostFleet?: boolean;
}

/** 终局名次 vp（第 1/2/3/4 名）。 */
export const FINAL_RANK_VP: readonly [number, number, number, number] = [18, 12, 6, 0];

export const ROUND_SCORING: Record<ScoringTileId, RoundScoringDef> = {
  score1: { id: 'score1', name: 'terraform 步 +2vp', trigger: { on: 'terraform-step', vp: 2 } },
  score2: { id: 'score2', name: '研究推进 +2vp', trigger: { on: 'research', vp: 2 } },
  score3: { id: 'score3', name: '建矿 +2vp', trigger: { on: 'build-mine', vp: 2 } },
  score4: { id: 'score4', name: '组建联邦 +5vp', trigger: { on: 'form-federation', vp: 5 } },
  score5: { id: 'score5', name: '升贸易站 +4vp', trigger: { on: 'upgrade-ts', vp: 4 } },
  score6: { id: 'score6', name: 'Gaia 建矿 +4vp', trigger: { on: 'build-mine-gaia', vp: 4 } },
  score7: { id: 'score7', name: '升 PI/学院 +5vp', trigger: { on: 'upgrade-pi-academy', vp: 5 } },
  score8: { id: 'score8', name: '升贸易站 +3vp', trigger: { on: 'upgrade-ts', vp: 3 } },
  score9: { id: 'score9', name: 'Gaia 建矿 +3vp', trigger: { on: 'build-mine-gaia', vp: 3 } },
  score10: { id: 'score10', name: '升 PI/学院 +5vp', trigger: { on: 'upgrade-pi-academy', vp: 5 } },
  // --- Lost Fleet ---
  scorelf1: {
    id: 'scorelf1',
    name: '新扇区建矿 +3vp',
    trigger: { on: 'build-mine-new-sector', vp: 3 },
    lostFleet: true,
  },
  scorelf2: {
    id: 'scorelf2',
    name: '新星球类型建矿 +3vp',
    trigger: { on: 'build-mine-new-planet-type', vp: 3 },
    lostFleet: true,
  },
  scorelf3: {
    id: 'scorelf3',
    name: '建实验室 +4vp',
    trigger: { on: 'build-lab', vp: 4 },
    lostFleet: true,
  },
};

export const FINAL_SCORING: Record<FinalTileId, FinalScoringDef> = {
  structure: { id: 'structure', name: '建筑总数最多', condition: 'structure', neutralValue: 11 },
  structureFed: {
    id: 'structureFed',
    name: '联邦内建筑最多',
    condition: 'structure-fed',
    neutralValue: 10,
  },
  planetType: {
    id: 'planetType',
    name: '殖民星球类型最多',
    condition: 'planet-type',
    neutralValue: 5,
  },
  gaia: { id: 'gaia', name: 'Gaia 星球最多', condition: 'gaia', neutralValue: 4 },
  sector: { id: 'sector', name: '殖民扇区最多', condition: 'sector', neutralValue: 6 },
  satellite: { id: 'satellite', name: '卫星最多', condition: 'satellite', neutralValue: 8 },
  // --- Lost Fleet（中立占位数值规则书文本层无，【未确认】取合理值）---
  asteroid: {
    id: 'asteroid',
    name: '殖民小行星最多',
    condition: 'asteroid',
    neutralValue: 3, // 【未确认】
    lostFleet: true,
  },
  deepSpace: {
    id: 'deepSpace',
    name: '殖民深空扇区最多',
    condition: 'deep-space',
    neutralValue: 3, // 【未确认】
    lostFleet: true,
  },
  piAcademyDistance: {
    id: 'piAcademyDistance',
    name: 'PI 与学院距离最远',
    condition: 'pi-academy-distance',
    neutralValue: 8, // 【未确认】
    lostFleet: true,
  },
};

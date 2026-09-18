/**
 * 18 族数据：14 基础族 + Lost Fleet 4 族。
 * 数据核对：reference/gaia-engine/src/faction-boards/*.ts（起始资源/能量/收入轨，
 * 精确）+ reference/gaia-base-rules.txt Appendix I（能力原文）+
 * reference/lost-fleet-rules.txt Appendix I（LF 4 族）。
 *
 * 默认面板（未覆盖即为此值）：起始 3k+4o+15c+1q；I 区 2 枚 / II 区 4 枚；
 * 收入轨 mine 揭 +1o（第 3 格空）、TS +3c/+4c/+4c/+5c、lab +1k、
 * 学院1 +2k、PI 充能 4pw + 1 power token。
 * 注：lab/学院 income 格在 gaia-engine 中含 "tech"——那是升级拿科技板的一次性
 * 奖励，不是收入，本表不收录。
 *
 * Lost Fleet 种族微调（设置时）：Ivits 起始 I 区 2pw + II 区 2pw；Bescods
 * 起始 3k；Lantids 设置时 +1 power 到 I 区（<4 人用修订 PI 板块）；Xenos 新
 * 免费行动 1o→1 power 直接 III 区；Gleens 探索板特殊行动 gleens-range
 * （建矿/盖亚计划/探索飞船射程 +2）。
 */
import type {
  FactionId,
  HomePlanetType,
  PlanetType,
  ResearchTrack,
  Resources,
} from '../types.js';
import type { ResourceGain } from './rewards.js';

/** 族属能力（机器可读 id + 中文规则摘要）。 */
export interface FactionAbility {
  /** 行动类 id 与 SpecialActionId / FreeConversionId 对齐。 */
  id: string;
  text: string;
}

/** 收入轨（面板建筑格下印刷的收入，随建筑放到地图上逐格揭开）。 */
export interface IncomeTrackDef {
  /** mine 8 格；null = 空格（第 3 格无收入）。 */
  mine: readonly [
    ResourceGain | null,
    ResourceGain | null,
    ResourceGain | null,
    ResourceGain | null,
    ResourceGain | null,
    ResourceGain | null,
    ResourceGain | null,
    ResourceGain | null,
  ];
  /** TS 4 格。 */
  ts: readonly [ResourceGain, ResourceGain, ResourceGain, ResourceGain];
  /** lab 3 格。 */
  lab: readonly [ResourceGain, ResourceGain, ResourceGain];
  /** 学院1 1 格（学院2 无收入，是特殊行动格 ac2：+1q，baltaks 为 +4c）。 */
  ac1: ResourceGain;
  /** PI 1 格。 */
  pi: ResourceGain;
}

export interface FactionDef {
  id: FactionId;
  name: string;
  /** 母星类型；LF 4 族无母星（起始在 asteroid/protoplanet）。 */
  homePlanet: HomePlanetType | null;
  color: string;
  startingResources: Resources;
  startingPower: { bowl1: number; bowl2: number; brainstone?: 'bowl1' };
  /** 起始 L1 的研究轨（设置时升 1 级；星标一次性奖励立即获得，eco/sci L1 收入不获得）。 */
  startingResearch: ResearchTrack | null;
  /** 第二条起始 L1 研究轨（仅 darkanians：+1 Nav +1 Eco）。 */
  startingResearch2?: ResearchTrack;
  /** 起始放置的矿数（xenos 3、ivits 0=改为放 PI、LF 新族见能力）。 */
  startingMines: number;
  /** LF 新族的起始星球类型（asteroid/protoplanet）。 */
  startingPlanetType?: PlanetType;
  /** LF 新族 terraform 规则：所有标准星球固定步数（darkanians 1、space-giants 2）。 */
  terraformAllSteps?: number;
  /** LF 新族 terraform 规则：3 种基础星球 3 步、其余 1 步（setup 时 rng 抽取，tinkeroids/moweyds）。 */
  terraformThreeStepRoll?: boolean;
  /** 每轮收入阶段的基础收入（族面板印刷；来源 gaia-engine faction-boards income[1]）。 */
  baseIncome: ResourceGain;
  abilities: FactionAbility[];
  piAbility: FactionAbility | null;
  incomeTrack: IncomeTrackDef;
}

const MINE_TRACK_DEFAULT: IncomeTrackDef['mine'] = [
  { ore: 1 },
  { ore: 1 },
  null, // 第 3 格空
  { ore: 1 },
  { ore: 1 },
  { ore: 1 },
  { ore: 1 },
  { ore: 1 },
];

const TS_TRACK_DEFAULT: IncomeTrackDef['ts'] = [
  { credits: 3 },
  { credits: 4 },
  { credits: 4 },
  { credits: 5 },
];

const LAB_TRACK_DEFAULT: IncomeTrackDef['lab'] = [
  { knowledge: 1 },
  { knowledge: 1 },
  { knowledge: 1 },
];

const PI_INCOME_DEFAULT: ResourceGain = { chargePower: 4, powerToken: 1 };

const DEFAULT_INCOME_TRACK: IncomeTrackDef = {
  mine: MINE_TRACK_DEFAULT,
  ts: TS_TRACK_DEFAULT,
  lab: LAB_TRACK_DEFAULT,
  ac1: { knowledge: 2 },
  pi: PI_INCOME_DEFAULT,
};

const DEFAULT_STARTING_RESOURCES: Resources = { ore: 4, credits: 15, knowledge: 3, qic: 1 };

export const FACTIONS: Record<FactionId, FactionDef> = {
  // -------------------------------------------------------------------------
  // 基础 14 族
  // -------------------------------------------------------------------------
  terrans: {
    id: 'terrans',
    name: 'Terrans',
    homePlanet: 'terra',
    color: 'blue',
    startingResources: DEFAULT_STARTING_RESOURCES,
    startingPower: { bowl1: 4, bowl2: 4 },
    startingResearch: 'gaia',
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'terrans-gaia-to-bowl2',
        text: '盖亚阶段：Gaia 区的 power token 移到 II 区（而非 I 区）。',
      },
    ],
    piAbility: {
      id: 'terrans-gaia-spend',
      text: '盖亚阶段：Gaia 区 power 移向 II 区时，可把这些 power 当免费兑换使用（4pw→1q / 3pw→1o / 4pw→1k / 1pw→1c）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  lantids: {
    id: 'lantids',
    name: 'Lantids',
    homePlanet: 'terra',
    color: 'blue',
    startingResources: { ore: 4, credits: 13, knowledge: 3, qic: 1 },
    startingPower: { bowl1: 4, bowl2: 0 },
    startingResearch: null,
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'lantids-mine-on-opponent',
        text: '建矿行动可建在对手已殖民星球上（含 Lost Planet）：免 terraform 费、矿费照付；该矿不可升级，不计入星球类型/Gaia 星球计数。',
      },
    ],
    piAbility: {
      id: 'lantids-pi',
      text: '每次在对手已殖民星球上建矿 +2k。（LF <4 人用修订 PI 板块：solo/2 人面改为对手星球与母星建矿均 +2k；3 人面为对手星球建矿额外充能 1pw。）',
    },
    incomeTrack: { ...DEFAULT_INCOME_TRACK, pi: { chargePower: 4 } },
  },
  xenos: {
    id: 'xenos',
    name: 'Xenos',
    homePlanet: 'desert',
    color: 'yellow',
    startingResources: DEFAULT_STARTING_RESOURCES,
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: 'int',
    startingMines: 3,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'xenos-third-mine',
        text: '起始放置第 3 个矿（在所有起始矿放完后放置）。（LF 新增免费行动 xenos-o-t3：1o→1 power token 直接 III 区。）',
      },
    ],
    piAbility: {
      id: 'xenos-pi',
      text: '组建联邦只需总 power value 6（替代 7）；PI 收入 +1q 替代 +1 power token。',
    },
    incomeTrack: { ...DEFAULT_INCOME_TRACK, pi: { chargePower: 4, qic: 1 } },
  },
  gleens: {
    id: 'gleens',
    name: 'Gleens',
    homePlanet: 'desert',
    color: 'yellow',
    startingResources: { ore: 4, credits: 15, knowledge: 3, qic: 0 },
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: 'nav',
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'gleens-qic-to-ore',
        text: '获得 QIC 时改为获得等量 ore（建 QIC 学院后失效）；Gaia 星球居住费付 1o 替代 1q；每次在 Gaia 星球建矿 +2vp。（LF 探索板特殊行动 gleens-range：建矿/盖亚计划/探索飞船射程 +2。）',
      },
    ],
    piAbility: {
      id: 'gleens-pi',
      text: '升级 PI 时立即获得 Gleens 专属联邦标记（算组建一次联邦；PI 本身仍可参与地图上的联邦）。',
    },
    incomeTrack: { ...DEFAULT_INCOME_TRACK, pi: { chargePower: 4, ore: 1 } },
  },
  taklons: {
    id: 'taklons',
    name: 'Taklons',
    homePlanet: 'swamp',
    color: 'brown',
    startingResources: DEFAULT_STARTING_RESOURCES,
    startingPower: { bowl1: 2, bowl2: 4, brainstone: 'bowl1' },
    startingResearch: null,
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'taklons-brainstone',
        text: 'Brainstone 算 1 个 power token（盖亚计划/卫星等），花费时可当 3 power；起始在 I 区。',
      },
    ],
    piAbility: {
      id: 'taklons-pi',
      text: '每次被动充能（对手建筑触发）时获得 1 power token（可选择先充能或先拿 token）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  ambas: {
    id: 'ambas',
    name: 'Ambas',
    homePlanet: 'swamp',
    color: 'brown',
    startingResources: DEFAULT_STARTING_RESOURCES,
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: 'nav',
    startingMines: 2,
    baseIncome: { ore: 2, knowledge: 1 },
    abilities: [],
    piAbility: {
      id: 'ambas-swap',
      text: '每轮一次行动：交换 PI 与地图上一个己方矿的位置（不影响已有联邦；不算建造/升级，无 vp/充能）。',
    },
    incomeTrack: { ...DEFAULT_INCOME_TRACK, pi: { chargePower: 4, powerToken: 2 } },
  },
  'hadsch-hallas': {
    id: 'hadsch-hallas',
    name: 'Hadsch Hallas',
    homePlanet: 'oxide',
    color: 'red',
    startingResources: DEFAULT_STARTING_RESOURCES,
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: 'eco',
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1, credits: 3 },
    abilities: [],
    piAbility: {
      id: 'hadsch-pi',
      text: '可用 credits 替代 power 做免费兑换（4c→1q / 3c→1o / 4c→1k）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  ivits: {
    id: 'ivits',
    name: 'Ivits',
    homePlanet: 'oxide',
    color: 'red',
    startingResources: DEFAULT_STARTING_RESOURCES,
    // 起始 I 区 2pw + II 区 2pw（参考 faction-boards/ivits.ts standard 板；非 LF 特有）。
    startingPower: { bowl1: 2, bowl2: 2 },
    startingResearch: null,
    startingMines: 0,
    baseIncome: { ore: 1, knowledge: 1, qic: 1 },
    abilities: [
      {
        id: 'ivits-setup-pi',
        text: '设置时不放矿：所有其他玩家放完矿（含 Xenos 第 3 矿）后，把 PI 放到任一红色星球上。',
      },
      {
        id: 'ivits-one-federation',
        text: '全游戏只能有一个联邦：再次组联邦必须把新星球连入该联邦，其建筑使联邦总 power value ≥7X（X=已有联邦标记数+1，不含 Terraforming L5 标记）；此行动中建卫星付 1q 替代弃 1 power。',
      },
    ],
    piAbility: {
      id: 'ivits-sp',
      text: '特殊行动：放一个空间站（可达且无星球/空间站的空间格；pv 1；可用卫星连接、可作射程起点；不算建筑/殖民星球，对手不充能）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  geodens: {
    id: 'geodens',
    name: 'Geodens',
    homePlanet: 'volcanic',
    color: 'orange',
    startingResources: DEFAULT_STARTING_RESOURCES,
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: 'terra',
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [],
    piAbility: {
      id: 'geodens-pi',
      text: '建 PI 后，首次在每种星球类型上建矿 +3k（建 PI 前已殖民的类型不计）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  baltaks: {
    id: 'baltaks',
    name: "Bal T'aks",
    homePlanet: 'volcanic',
    color: 'orange',
    // 起始 3k,4o,15c（无 q；参考 faction-boards/baltaks.ts "3k,4o,15c,up-gaia"）。
    startingResources: { ore: 4, credits: 15, knowledge: 3, qic: 0 },
    startingPower: { bowl1: 2, bowl2: 2 },
    startingResearch: 'gaia',
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'baltaks-no-nav',
        text: '不能推进 Navigation 轨（拿该轨正下方科技板也不推进；建 PI 后解锁）。',
      },
      {
        id: 'baltaks-gf-q',
        text: '免费行动：把面板上 1 个 Gaiaformer 移入 Gaia 区换 1q（下轮盖亚阶段移回面板）。',
      },
      {
        id: 'baltaks-ac2-4c',
        text: 'QIC 学院的特殊行动为 +4c（替代 +1q）。',
      },
    ],
    piAbility: {
      id: 'baltaks-pi',
      text: '解锁 Navigation 轨推进。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  firaks: {
    id: 'firaks',
    name: 'Firaks',
    homePlanet: 'titanium',
    color: 'gray',
    startingResources: { ore: 3, credits: 15, knowledge: 2, qic: 1 },
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: null,
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 2 },
    abilities: [],
    piAbility: {
      id: 'firaks-down',
      text: '行动：把一个 lab 降级回 TS，立即推进任一研究轨 1 级（算"升级到贸易站"行动；之后可正常再升级并拿新科技板）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  bescods: {
    id: 'bescods',
    name: 'Bescods',
    homePlanet: 'titanium',
    color: 'gray',
    // 起始 3k,4o,15c,q（参考 faction-boards/bescods.ts "3k,4o,15c,q"）。
    startingResources: { ore: 4, credits: 15, knowledge: 3, qic: 1 },
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: null,
    startingMines: 2,
    baseIncome: { ore: 1 },
    abilities: [
      {
        id: 'bescods-swap-tracks',
        text: '面板上 PI 与学院位置互换，TS 与 lab 收入互换（升级 lab/学院照常拿科技板）。',
      },
      {
        id: 'bescods-up',
        text: '每轮一次行动：免费推进等级最低的研究轨 1 级（并列自选；升 L5 仍需翻联邦标记，每轨仍限 1 人）。',
      },
    ],
    piAbility: {
      id: 'bescods-pi',
      text: '灰色（钛）星球上的己方建筑 power value +1（可与其它 pv 加成叠加）。',
    },
    incomeTrack: {
      mine: MINE_TRACK_DEFAULT,
      ts: [{ knowledge: 1 }, { knowledge: 1 }, { knowledge: 1 }, { knowledge: 1 }],
      lab: [{ credits: 3 }, { credits: 4 }, { credits: 5 }],
      ac1: { knowledge: 2 },
      pi: { chargePower: 4, powerToken: 2 },
    },
  },
  nevlas: {
    id: 'nevlas',
    name: 'Nevlas',
    homePlanet: 'ice',
    color: 'white',
    startingResources: { ore: 4, credits: 15, knowledge: 2, qic: 1 },
    startingPower: { bowl1: 2, bowl2: 4 },
    startingResearch: 'sci',
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'nevlas-pw-k',
        text: '免费行动：III 区 1 个 power token 移入 Gaia 区换 1k（不算花费 power，gaia 区 token 按正常盖亚阶段规则移动）。',
      },
    ],
    piAbility: {
      id: 'nevlas-pi',
      text: 'III 区 power token 花费时每个当 2 power（付奇数费用时找零损失）；解锁免费兑换 4pw→1o+1c、6pw→2o。',
    },
    incomeTrack: {
      ...DEFAULT_INCOME_TRACK,
      lab: [{ chargePower: 2 }, { chargePower: 2 }, { chargePower: 2 }],
    },
  },
  itars: {
    id: 'itars',
    name: 'Itars',
    homePlanet: 'ice',
    color: 'white',
    startingResources: { ore: 5, credits: 15, knowledge: 3, qic: 1 },
    startingPower: { bowl1: 4, bowl2: 4 },
    startingResearch: null,
    startingMines: 2,
    baseIncome: { ore: 1, knowledge: 1, powerToken: 1 },
    abilities: [
      {
        id: 'itars-burn-to-gaia',
        text: '烧脑弃掉的 II 区 token 放入 Gaia 区（而非回供应堆）。',
      },
    ],
    piAbility: {
      id: 'itars-gaia',
      text: '盖亚阶段：可弃 4 个 Gaia 区 power 换 1 块科技板（标准或高级），可重复多次。',
    },
    incomeTrack: { ...DEFAULT_INCOME_TRACK, ac1: { knowledge: 3 } },
  },
  // -------------------------------------------------------------------------
  // Lost Fleet 4 族（无母星；Gaia 居住费 darkanians/space-giants 2q、
  // tinkeroids/moweyds 1q；第二阶段放置起始建筑；
  // 起始面板实证核定：基本收入均 +1o+1k，TS/RL/AC 收入轨标准，探索穿梭机 5vp）
  // -------------------------------------------------------------------------
  tinkeroids: {
    id: 'tinkeroids',
    name: 'Tinkeroids',
    homePlanet: null,
    color: 'pink',
    startingResources: { ore: 4, credits: 15, knowledge: 2, qic: 1 },
    startingPower: { bowl1: 4, bowl2: 2 },
    startingResearch: 'sci',
    startingMines: 0, // 起始放 PI（第二阶段放置）
    startingPlanetType: 'asteroid',
    terraformThreeStepRoll: true,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'tinkeroids-terraform',
        text: '3 种基础星球需 3 terraform 步、其余基础星球 1 步（设置时抽卫星块决定 3 步类型）；Gaia 居住费 1q；起始放 PI 而非 2 矿（第二阶段放置）。',
      },
      {
        id: 'tinkeroids-tiles',
        text: '6 块 Tinkering tiles（1–3 轮组 3 块 / 4–6 轮组 3 块）：每轮开始选 1 块放面板，回合结束移除（每块限用一次）。',
      },
    ],
    piAbility: {
      id: 'tinkeroids-tile',
      text: '每轮一次：把当前 Tinkering tile 上的行动当作自己的行动使用。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  darkanians: {
    id: 'darkanians',
    name: 'Darkanians',
    homePlanet: null,
    color: 'pink',
    startingResources: { ore: 7, credits: 15, knowledge: 3, qic: 1 },
    startingPower: { bowl1: 4, bowl2: 2 },
    startingResearch: 'nav',
    startingResearch2: 'eco',
    startingMines: 1,
    startingPlanetType: 'asteroid',
    terraformAllSteps: 1,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'darkanians-terraform',
        text: '标准星球 1 terraform 步；Gaia 居住费 2q；起始 1 矿（第二阶段放置）。',
      },
    ],
    piAbility: {
      id: 'darkanians-pi',
      text: '首次在每个 Space/Deep Space 扇区殖民星球 +2c+1k（Interspace 不算扇区）。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  moweyds: {
    id: 'moweyds',
    name: 'Moweyds',
    homePlanet: null,
    color: 'turquoise',
    startingResources: { ore: 6, credits: 15, knowledge: 5, qic: 2 },
    startingPower: { bowl1: 4, bowl2: 4 },
    startingResearch: 'gaia',
    startingMines: 1,
    startingPlanetType: 'proto',
    terraformThreeStepRoll: true,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'moweyds-setup',
        text: '起始 1 矿（第二阶段放置）；开局即有 1 个穿梭机在 T F Mars 上；terraform 同 Tinkeroids（3 种基础星球 3 步、其余 1 步，设置时决定）。',
      },
    ],
    piAbility: {
      id: 'moweyds-ring',
      text: '每轮一次行动：放一个 Power Ring（共 6 个）到有己方建筑且无环的星球，该建筑 power value +2。',
    },
    incomeTrack: DEFAULT_INCOME_TRACK,
  },
  'space-giants': {
    id: 'space-giants',
    name: 'Space Giants',
    homePlanet: null,
    color: 'turquoise',
    startingResources: { ore: 6, credits: 15, knowledge: 3, qic: 1 },
    startingPower: { bowl1: 4, bowl2: 4 },
    startingResearch: 'nav',
    startingMines: 1,
    startingPlanetType: 'proto',
    terraformAllSteps: 2,
    baseIncome: { ore: 1, knowledge: 1 },
    abilities: [
      {
        id: 'space-giants-terraform',
        text: '标准星球 2 terraform 步；Gaia 居住费 2q；起始 1 矿（第二阶段放置）。',
      },
      {
        id: 'space-giants-mine',
        text: '探索板特殊行动：建矿（2 免费 terraform 步）。',
      },
    ],
    piAbility: {
      id: 'space-giants-pi',
      text: '一次性：立即拿 1 块科技板（规则同升级拿板）。',
    },
    incomeTrack: { ...DEFAULT_INCOME_TRACK, pi: { chargePower: 6, powerToken: 1 } },
  },
};

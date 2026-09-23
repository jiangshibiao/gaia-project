/**
 * heuristic2 估价配置：一切权重集中在 BASE_CFG，版本/变体/种族差异全部用
 * DeepPartial overrides 深合并表达（参照 BrassBirmingham heuristic-core 的
 * CFG + overrides 模式）。每个叶子参数尽量注明来源（BGG 攻略帖量化结论或
 * bench 实验），调参只动这里。
 *
 * 变体（加不加 Lost Fleet）显式区分：LF_DELTA 在 lostFleet=true 时深合并到
 * BASE_CFG 之上——扩展改变资源/扩张/终局的相对价值（如行星类型升值、
 * Terrans 类盖亚垄断打法贬值），种族强度差异见 factions.ts 的
 * FACTION_STRENGTH（同样按变体分表）。
 */

/** 规则集变体：base = 基础 14 族无扩展；lostFleet = 含失落舰队扩展。 */
export type Variant = 'base' | 'lostFleet';

/** 对局阶段：R1-2 建经济、R3-4 扩张转化、R5-6 VP 冲刺（社区共识节奏）。 */
export type Phase = 'early' | 'mid' | 'late';

export interface Cfg {
  /**
   * 资源→VP 等值。社区量化帖（BGG thread/2122654 修正版，credit=1 基准）：
   * ore=knowledge=3、QIC=4、power token=2、充能 1pw=0.75、1 改造步≈4。
   */
  resources: {
    vp: number;
    ore: number;
    credits: number;
    knowledge: number;
    qic: number;
    powerToken: number;
    chargePower: number;
    gaiaformer: number;
    /** III 区 pw 即战力（比充能中的 pw 略贵）。 */
    spendPower: number;
  };
  /** 分阶段权重：收入的贴现、库存资源贬值、leech 意愿、扩张价值。 */
  phase: Record<
    Phase,
    {
      /** 收入 NPV 倍率（R3 是收入投入盈亏平衡点，之后收入权重衰减）。 */
      incomeMult: number;
      /** 库存资源价值倍率（末轮资源只能折价换 VP）。 */
      stockMult: number;
      /** 充能（leech 接受与送对手充能）价值倍率：R1-4 雪球期 >1，R6 <1。 */
      chargeMult: number;
      /** 扩张类进程（新星球类型/新扇区/殖民计数）价值倍率。 */
      expansionMult: number;
      /** 联邦凑组拉力倍率：前期强（先立簇再扩张），后期弱。 */
      clusterMult: number;
    }
  >;
  research: {
    /** terraform 折扣按未来 N 步回本估算。 */
    terraFutureSteps: number;
    /** nav 每格射程价值（扩张可达性）。 */
    rangePerStep: number;
    /** Lost Planet ≈ 免费矿 + 独立类型 + 卫星 + 殖民计数。 */
    lostPlanet: number;
    /** 终局每轨 L3/L4/L5 各 +4vp。 */
    milestoneVp: number;
  };
  mine: {
    /** 扩张基底（殖民计数/终局 structure 进程/未来联邦功率）。 */
    base: number;
    /** LF 原行星建矿 +6vp。 */
    protoVp: number;
    /** 新星球类型（planetType 终局 + 片进程）。 */
    newPlanetType: number;
    /** 新扇区（sector 终局进程）。 */
    newSector: number;
    /** 收回留置 gaiaformer。 */
    gaiaformerRecover: number;
    /** asteroid 报废 gaiaformer 的净折价。 */
    asteroidPenalty: number;
    /** 凑满 7 电联邦组的总价（凸形：(pv/7)²×本值）——组越接近 7 电拉力越强。 */
    clusterPv: number;
    /** 2 格内有己方建筑的固定加成（早期种子簇的形成信号，凸形拉力启动前生效）。 */
    clusterFlat: number;
    /** 成长空间：目标格 2 格内每个可殖民空星球的价值（避免钻进无法扩大的死胡同簇）。 */
    growthRoom: number;
    /** leech 吸附：2 格内每个对手建筑的充能期望（×chargeMult，对手建造时送我充能）。 */
    leechPull: number;
  };
  upgrade: {
    /** 联邦功率增量的组电力权重（同 mine.clusterPv：升级提升组 pv 密度）。 */
    pvGain: number;
    /** PI 种族能力解锁估值。 */
    piUnlock: number;
    /** TS 是经济骨干（信用收入+依附充能磁石），收入轨之外的固定溢价。 */
    tsBonus: number;
    /** 第二座学院的惩罚（6o+6c 极贵且 AC2 无收入，通常不如升 TS/PI）。 */
    secondAcademyPenalty: number;
  };
  federation: {
    /** 联邦基底（L5/高级板门票 + 零和挤压；3 联邦是获胜底线，能组就组）。 */
    base: number;
    /** structureFed 终局进程 / hex。 */
    perHex: number;
    /** 卫星成本（弃 power token）/ 个。 */
    satelliteCost: number;
    /** satellite 终局进程 / 个。 */
    satelliteProgress: number;
    /** 第 targetCount 个联邦的额外奖励（社区共识：3 联邦是获胜底线）。 */
    thirdBonus: number;
    /** 目标联邦数（整体策略目标：联邦数朝 ≥3 推进）。 */
    targetCount: number;
    /** 联邦缺口期的簇拉力加成：簇拉力 ×(1 + max(0, target−1−held) × 本值)。 */
    deficitClusterBoost: number;
  };
  boardAction: {
    buildMine: number;
    gainTechTile: number;
    /** 占格机会成本 / 轮（后期格更紧）。 */
    slotCostPerRound: number;
  };
  ship: {
    freeUpgradeLab: number;
    freeUpgradeTs: number;
    buildMine: number;
    buildMineAsteroid: number;
    gaiaImmediate: number;
    range: number;
    gainTechTile: number;
  };
  explore: {
    /** 解锁价值（每剩余轮）——Rebellion/Twilight 行动格+舰载板+第 7 槽。 */
    valuePerRoundLeft: number;
    /** nevlas/itars/taklons 的族属额外费用。 */
    factionPenalty: number;
    /** 首船前期优先（×roundsLeft/5；第 2 艘减半、第 3 艘 1/4）——早上船早解锁行动格。 */
    earlyShipBonus: number;
    /** vp 低于登船费时 VP 收益的加权（1 + (cost−vp)/cost×本值）——优先攒分登船。 */
    vpDeficitPull: number;
  };
  pass: {
    /** 首个 pass 的先手价值（下轮首动）。 */
    firstPassBonus: number;
    /** 还负担得起主行动就 pass 的 tempo 惩罚（×剩余轮数）。 */
    tempoPenaltyPerRound: number;
    /** 第 6 轮裸 pass（无新助推器）惩罚。 */
    lastRoundNaked: number;
  };
  charge: {
    /** leech 接受的 vp 成本率（accept = amount×chargePower×chargeMult − vpCost×rate）。 */
    vpCostRate: number;
  };
  gaiaProject: {
    base: number;
    firstGaia: number;
    /** 移入 Gaia 区 power 的机会成本率。 */
    powerCostRate: number;
    lastRoundPenalty: number;
  };
  setup: {
    base: number;
    perTerraformStep: number;
    /** 2 格内有对手建筑（未来依附充能）。 */
    nearOpponent: number;
    /** 己方聚拢（联邦潜力）。 */
    cluster: number;
    deepSpace: number;
  };
  /** 科技片相关溢价。 */
  tech: {
    /** 高级片稀缺溢价（人类基准 12-16 VP/片，破同分并列）。 */
    advPremium: number;
  };
  /** 回合计分板对齐。 */
  scoring: {
    /** 下一轮计分板的预期兑现（权重折扣——下轮局面未到，兑现不确定）。 */
    nextRoundMult: number;
  };
  /** 终局计分（叶估值内）：零和位次期望。 */
  final: {
    weight: number;
  };
  /** 局面叶估值（lookahead 终端）。 */
  leaf: {
    /** 联邦标记的未来重结算价值（vp 已入账，只计资源面期望）。 */
    federationValue: number;
    /** 持有科技片/高级片的折算（相对 action 评分里的全额）。 */
    techTileMult: number;
    advTileMult: number;
    /** 第 2/3 簇潜力权重（相对第 1 簇）——多簇并行是 3 联邦的几何前提。 */
    fedGroup2Mult: number;
    fedGroup3Mult: number;
  };
  /** 自我深搜（假设不碰撞：对手占位，只展开我的行动序列）。 */
  selfSearch: {
    enabled: boolean;
    /** 我的主行动规划步数（每一步之间对手快进占位）。 */
    depth: number;
    /** 节点预算（确定性截断）。 */
    nodeBudget: number;
    /** 各层候选帽（我的第 ply 个决策点）。 */
    caps: number[];
    /** 根节点次优值权重（0.8×最优+0.2×次优，brittle plan 对冲）。 */
    secondWeight: number;
  };
  /** 确定性深搜（max^n，非 MCTS；enabled 时覆盖 lookahead 路径）。 */
  search: {
    enabled: boolean;
    /** 搜索深度（ply 数，含对手行动；4p 下到我的下个主行动约需 5-6 ply）。 */
    depth: number;
    /** 节点预算（按节点数而非墙钟，确定性截断）。 */
    nodeBudget: number;
    /** 各层候选帽（离根越远越紧；超出取末位）。 */
    caps: number[];
  };
  lookahead: {
    enabled: boolean;
    /** 次动分权重（首动分 + alpha × max(0, 次动分)）。 */
    alpha: number;
    /** 候选叶估值权重（相对行动分 1.0；>1 会稀释行动分，Brass 教训 2.0 失败）。 */
    leafWeight: number;
    /** 每行动域进入仿真的候选数（Brass 经验：K 过大反而更差）。 */
    topK: {
      mine: number;
      upgrade: number;
      research: number;
      federation: number;
      board: number;
      special: number;
      ship: number;
      gaia: number;
      explore: number;
      pass: number;
      free: number;
      misc: number;
      setup: number;
    };
  };
}

export const BASE_CFG: Cfg = {
  resources: {
    vp: 1,
    ore: 2.5,
    credits: 1,
    knowledge: 2.5,
    qic: 4,
    powerToken: 2,
    chargePower: 0.75,
    gaiaformer: 4,
    spendPower: 0.6,
  },
  phase: {
    // R1-2：经济雪球期——收入全额、库存全额、leech 几乎无脑收（社区：R1-4 全收）。
    // 早期 clusterMult >1 会过度聚簇伤扩张（2p 实测 −5 分），保持 1。
    early: { incomeMult: 1, stockMult: 1, chargeMult: 1.4, expansionMult: 1, clusterMult: 1 },
    mid: { incomeMult: 0.7, stockMult: 0.8, chargeMult: 1.1, expansionMult: 0.9, clusterMult: 1 },
    late: { incomeMult: 0.6, stockMult: 0.35, chargeMult: 0.7, expansionMult: 0.7, clusterMult: 0.7 },
  },
  research: {
    // 全局改造步数预期（回本估算）：一局实际付费改造 ~5-8 步。
    terraFutureSteps: 5,
    // nav 每格射程≈解锁 2-3 颗可及星球（每颗净值 ~2-3）：nav2 近乎必冲。
    rangePerStep: 6,
    lostPlanet: 10,
    milestoneVp: 4,
  },
  mine: {
    // 扩张是盖亚的命脉：矿的长期回报 = 收入+联邦进程+leech+计分板，远超建造成本。
    base: 9,
    protoVp: 6,
    newPlanetType: 2,
    newSector: 1.5,
    gaiaformerRecover: 2.5,
    asteroidPenalty: 3.5,
    clusterPv: 40,
    clusterFlat: 2,
    growthRoom: 1,
    leechPull: 1.2,
  },
  upgrade: {
    pvGain: 40,
    piUnlock: 10,
    tsBonus: 5,
    secondAcademyPenalty: 8,
  },
  federation: {
    base: 10,
    perHex: 0.4,
    // 卫星 = 永久丢弃 1 power token（≈2）− 卫星终局进程：净成本约 1.5。
    satelliteCost: 1.5,
    satelliteProgress: 0.3,
    thirdBonus: 6,
    targetCount: 3,
    // 调大未提升联邦数且拖分（−2 分：簇拉力增强同样伤扩张，同 clusterMult>1
    // 结论）——默认中性，留作 GAIA_TUNE_V2 消融位。
    deficitClusterBoost: 0,
  },
  boardAction: {
    buildMine: 7,
    gainTechTile: 6,
    slotCostPerRound: 0.1,
  },
  ship: {
    freeUpgradeLab: 9,
    freeUpgradeTs: 7,
    buildMine: 7,
    buildMineAsteroid: 6,
    gaiaImmediate: 4,
    range: 2,
    gainTechTile: 6,
  },
  explore: {
    valuePerRoundLeft: 1.4,
    factionPenalty: 1,
    earlyShipBonus: 0, // 基础变体无飞船，LF_DELTA 里开启
    vpDeficitPull: 0,
  },
  pass: {
    firstPassBonus: 1.5,
    tempoPenaltyPerRound: 0.8,
    lastRoundNaked: 3,
  },
  charge: {
    vpCostRate: 1,
  },
  gaiaProject: {
    // 盖亚计划 = 免费矿（transdim）+ 新类型 + 盖亚星计分进程，价值远高于 3。
    base: 10,
    firstGaia: 1,
    powerCostRate: 0.2,
    lastRoundPenalty: 50,
  },
  setup: {
    base: 12,
    perTerraformStep: 2.5,
    nearOpponent: 2,
    cluster: 6,
    deepSpace: 0.5,
  },
  tech: {
    advPremium: 8,
  },
  scoring: {
    nextRoundMult: 0.5,
  },
  final: {
    weight: 0.6,
  },
  leaf: {
    federationValue: 2,
    techTileMult: 0.5,
    advTileMult: 0.5,
    // 多簇并行潜力（联邦 ≥3 的几何前提）：满权档（0.7/0.5）实测 −2.1 分，
    // 取减半值；若仍拖分再归零（bench 裁决）。
    fedGroup2Mult: 0.35,
    fedGroup3Mult: 0.2,
  },
  selfSearch: {
    // depth4+6000 为当前平衡点：depth5 紧帽均分更高但最高均值下降（深度抬
    // 下限压上限——根帽收紧丢天花板）且耗时 ~2.5×；depth5+大预算单局 >50min
    // 不可行，不采用。
    enabled: true,
    depth: 4,
    nodeBudget: 6000,
    caps: [10, 8, 6, 4, 3],
    secondWeight: 0.2,
  },
  search: {
    enabled: false,
    depth: 4,
    nodeBudget: 1500,
    caps: [8, 5, 3, 2, 2, 2],
  },
  lookahead: {
    enabled: true,
    alpha: 0.5,
    leafWeight: 1.2,
    topK: {
      mine: 5,
      upgrade: 4,
      research: 3,
      federation: 2,
      board: 2,
      special: 2,
      ship: 2,
      gaia: 1,
      explore: 1,
      pass: 1,
      free: 2,
      misc: 2,
      setup: 5,
    },
  },
};

/**
 * Lost Fleet 变体增量（lostFleet=true 时深合并到 BASE_CFG 之上）。
 * 依据 LF 策略帖（BGG thread/3533221 等）：行星类型整体升值（更多类型+更多
 * 计分手段）；小行星/原行星是优质扩张目标；探船解锁的 Rebellion/Twilight
 * 行动格是必抢资源；盖亚形成类垄断打法贬值（在 factions.ts 按族处理）。
 */
export const LF_DELTA: DeepPartial<Cfg> = {
  mine: {
    newPlanetType: 3, // LF 行星类型计分手段变多，类型进程升值
    newSector: 2,
  },
  explore: {
    valuePerRoundLeft: 2, // 船载 QIC 行动+科技片+金联邦牌回本更快
    // earlyShipBonus 4 / vpDeficitPull 0.8 档实测 −2.2 分且未改变上船时点
    // （本就 R1-2 占多数）——默认中性，留作 GAIA_TUNE_V2 消融位。
    earlyShipBonus: 0,
    vpDeficitPull: 0,
  },
  scoring: {
    nextRoundMult: 0.8, // LF 轮均分更高，计分板对齐更值钱
  },
};

// ---------------------------------------------------------------------------
// DeepPartial + 深合并
// ---------------------------------------------------------------------------

export type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]?: DeepPartial<T[K]> }
      : T;

/** 深合并：src 的叶子覆盖 dst（undefined 不覆盖）。返回新对象，不改入参。 */
export function mergeCfg<T>(dst: T, src: DeepPartial<NoInfer<T>> | undefined): T {
  if (src === undefined) return dst;
  if (typeof dst !== 'object' || dst === null || Array.isArray(dst)) {
    return (src as T | undefined) ?? dst;
  }
  const out: Record<string, unknown> = { ...(dst as Record<string, unknown>) };
  for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (typeof cur === 'object' && cur !== null && !Array.isArray(cur) && typeof v === 'object') {
      out[k] = mergeCfg(cur, v as DeepPartial<typeof cur>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

/** 由 GameState 判定规则集变体（显式来源：开局 config）。 */
export function variantOf(state: { config: { lostFleet: boolean } }): Variant {
  return state.config.lostFleet ? 'lostFleet' : 'base';
}

/** 阶段划分：R1-2 early / R3-4 mid / R5-6 late（setup 轮 round=1 归 early）。 */
export function phaseOf(round: number): Phase {
  if (round <= 2) return 'early';
  if (round <= 4) return 'mid';
  return 'late';
}

/** 按变体合成有效 cfg（插件 overrides 在其后再合）。 */
export function cfgForVariant(variant: Variant, overrides?: DeepPartial<Cfg>): Cfg {
  let cfg = BASE_CFG;
  if (variant === 'lostFleet') cfg = mergeCfg(cfg, LF_DELTA);
  if (overrides !== undefined) cfg = mergeCfg(cfg, overrides);
  return cfg;
}

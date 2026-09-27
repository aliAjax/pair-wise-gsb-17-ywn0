// 监测井成井验收领域模型：钻孔、成井结构、洗井读数、版本与校验规则

export interface Borehole {
  id: string; // 孔号，如 ZK-09
  depth: number; // 孔深 m
  strata: string; // 主要地层
  note: string; // 备注
}

/** 井段，顶深 < 底深，单位 m（深度向下增大） */
export interface Section {
  top: number;
  bottom: number;
}

export interface Aquifer extends Section {
  name: string; // 目标含水层名称
}

export interface WellStructure {
  aquifer: Aquifer; // 目标含水层
  screen: Section; // 筛管段
  filter: Section; // 滤料段
  seal: Section; // 止水段
}

/** 单次洗井读数；null 表示尚未记录 */
export interface Reading {
  sand: number | null; // 含砂量 mg/L
  turbidity: number | null; // 浊度 NTU
}

export interface WellVersion {
  version: number;
  reason: string; // 版本原因：首版为“成井登记”，修正版为重开时填写的原因
  structure: WellStructure;
  readings: [Reading, Reading]; // 两次洗井
  confirmedBy: string; // 班组长确认人，空串表示未确认
  frozen: boolean; // 冻结后不可改，修正只能另建版本
  updatedAt: string;
}

export interface WellRecord {
  holeId: string;
  versions: WellVersion[]; // 末位为当前版本
}

/** 洗井达标阈值 */
export const SAND_LIMIT = 10; // mg/L
export const TURBIDITY_LIMIT = 10; // NTU

export function latestVersion(well: WellRecord): WellVersion {
  return well.versions[well.versions.length - 1];
}

/** 孔号自然排序：ZK-09 排在 ZK-18 前 */
export function compareHoleId(a: string, b: string): number {
  return a.localeCompare(b, "zh-CN", { numeric: true });
}

export function sortWellsByHole(wells: WellRecord[]): WellRecord[] {
  return wells.slice().sort((a, b) => compareHoleId(a.holeId, b.holeId));
}

function overlaps(a: Section, b: Section): boolean {
  return a.top < b.bottom && b.top < a.bottom;
}

function validSection(s: Section): boolean {
  return Number.isFinite(s.top) && Number.isFinite(s.bottom) && s.top >= 0 && s.top < s.bottom;
}

const fmt = (n: number) => n.toFixed(1);

export interface StructureIssue {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

/** 成井结构五条验收规则 */
export function checkStructure(s: WellStructure, holeDepth: number): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const sections: [string, Section][] = [
    ["目标含水层", s.aquifer],
    ["筛管", s.screen],
    ["滤料", s.filter],
    ["止水", s.seal],
  ];

  const missing = sections.some(([, sec]) => !Number.isFinite(sec.top) || !Number.isFinite(sec.bottom));
  const allValid = !missing && sections.every(([, sec]) => validSection(sec) && sec.bottom <= holeDepth);
  issues.push({
    id: "depths",
    label: "各段深度合法（顶深<底深，不超出孔深）",
    ok: allValid,
    detail: missing
      ? "各段深度未填完整"
      : allValid
        ? `各段均在 0–${fmt(holeDepth)}m 孔深内`
        : "存在顶深≥底深或底深超出孔深的井段",
  });

  const screenIn =
    validSection(s.screen) && validSection(s.aquifer) &&
    s.screen.top >= s.aquifer.top && s.screen.bottom <= s.aquifer.bottom;
  issues.push({
    id: "screen-in-aquifer",
    label: "筛管落在目标含水层内",
    ok: screenIn,
    detail: screenIn
      ? `筛管 ${fmt(s.screen.top)}–${fmt(s.screen.bottom)}m ⊂ 含水层 ${fmt(s.aquifer.top)}–${fmt(s.aquifer.bottom)}m`
      : `筛管 ${fmt(s.screen.top)}–${fmt(s.screen.bottom)}m 未完全落入含水层 ${fmt(s.aquifer.top)}–${fmt(s.aquifer.bottom)}m`,
  });

  const wraps =
    validSection(s.filter) && validSection(s.screen) &&
    s.filter.top <= s.screen.top && s.filter.bottom >= s.screen.bottom;
  issues.push({
    id: "filter-wraps-screen",
    label: "滤料段包住筛管",
    ok: wraps,
    detail: wraps
      ? `滤料 ${fmt(s.filter.top)}–${fmt(s.filter.bottom)}m 包住筛管`
      : `滤料 ${fmt(s.filter.top)}–${fmt(s.filter.bottom)}m 未完全包住筛管 ${fmt(s.screen.top)}–${fmt(s.screen.bottom)}m`,
  });

  const filterIn =
    validSection(s.filter) && validSection(s.aquifer) &&
    s.filter.top >= s.aquifer.top && s.filter.bottom <= s.aquifer.bottom;
  issues.push({
    id: "filter-in-aquifer",
    label: "滤料段不越过含水层",
    ok: filterIn,
    detail: filterIn
      ? `滤料段位于含水层 ${fmt(s.aquifer.top)}–${fmt(s.aquifer.bottom)}m 内`
      : `滤料 ${fmt(s.filter.top)}–${fmt(s.filter.bottom)}m 越过含水层边界 ${fmt(s.aquifer.top)}–${fmt(s.aquifer.bottom)}m`,
  });

  const conflict = validSection(s.seal) && validSection(s.screen) && overlaps(s.seal, s.screen);
  const overlapTop = Math.max(s.seal.top, s.screen.top);
  const overlapBottom = Math.min(s.seal.bottom, s.screen.bottom);
  issues.push({
    id: "seal-clear-of-screen",
    label: "止水段与筛管无冲突",
    ok: !conflict,
    detail: conflict
      ? `止水段 ${fmt(s.seal.top)}–${fmt(s.seal.bottom)}m 与筛管在 ${fmt(overlapTop)}–${fmt(overlapBottom)}m 重叠`
      : "止水段未触及筛管",
  });

  return issues;
}

export function structureOk(s: WellStructure, holeDepth: number): boolean {
  return checkStructure(s, holeDepth).every((i) => i.ok);
}

export function readingOk(r: Reading): boolean {
  return (
    r.sand !== null && r.turbidity !== null &&
    r.sand <= SAND_LIMIT && r.turbidity <= TURBIDITY_LIMIT
  );
}

/** 两次洗井均达标 */
export function developmentOk(readings: [Reading, Reading]): boolean {
  return readings.every(readingOk);
}

/** 可冻结条件：结构合规 + 两次洗井达标 + 班组长已确认 */
export function freezable(v: WellVersion, holeDepth: number): boolean {
  return (
    !v.frozen &&
    structureOk(v.structure, holeDepth) &&
    developmentOk(v.readings) &&
    v.confirmedBy.trim() !== ""
  );
}

export type WellStatus = "frozen" | "ready" | "pending";

export function wellStatus(well: WellRecord, holeDepth: number): WellStatus {
  const v = latestVersion(well);
  if (v.frozen) return "frozen";
  return freezable(v, holeDepth) ? "ready" : "pending";
}

export const statusText: Record<WellStatus, string> = {
  frozen: "已冻结验收",
  ready: "待冻结",
  pending: "未验收",
};

export function nowStamp(): string {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

// ---------- 种子数据 ----------

export const seedBoreholes: Borehole[] = [
  { id: "ZK-09", depth: 25.0, strata: "粉细砂", note: "水位 2.8m" },
  { id: "ZK-12", depth: 27.4, strata: "中砂夹砾", note: "水位 3.1m" },
  { id: "ZK-18", depth: 22.6, strata: "粉质黏土", note: "标贯12击，水位 3.4m" },
  { id: "ZK-21", depth: 31.2, strata: "卵石层", note: "夹中粗砂，取样困难" },
  { id: "ZK-24", depth: 18.4, strata: "强风化泥岩", note: "芯样完整率62%" },
  { id: "ZK-30", depth: 24.8, strata: "细砂", note: "水位 2.5m" },
];

const reading = (sand: number | null, turbidity: number | null): Reading => ({ sand, turbidity });

export const seedWells: WellRecord[] = [
  {
    holeId: "ZK-09",
    versions: [
      {
        version: 1,
        reason: "成井登记",
        structure: {
          aquifer: { name: "第Ⅰ承压含水层", top: 6, bottom: 20 },
          screen: { top: 8, bottom: 18 },
          filter: { top: 6.5, bottom: 18.5 },
          seal: { top: 1, bottom: 5.5 },
        },
        readings: [reading(4.2, 6.1), reading(3.1, 4.8)],
        confirmedBy: "王建国",
        frozen: true,
        updatedAt: "2026-09-20 16:40",
      },
    ],
  },
  {
    holeId: "ZK-12",
    versions: [
      {
        version: 1,
        reason: "成井登记",
        structure: {
          aquifer: { name: "第Ⅰ承压含水层", top: 5, bottom: 22 },
          screen: { top: 7, bottom: 20 },
          filter: { top: 6, bottom: 20.5 },
          seal: { top: 1, bottom: 4.5 },
        },
        readings: [reading(6.8, 7.4), reading(5.5, 6.0)],
        confirmedBy: "王建国",
        frozen: true,
        updatedAt: "2026-09-21 10:12",
      },
      {
        version: 2,
        reason: "滤料底深按测井曲线修正",
        structure: {
          aquifer: { name: "第Ⅰ承压含水层", top: 5, bottom: 22 },
          screen: { top: 7, bottom: 20 },
          filter: { top: 6, bottom: 21 },
          seal: { top: 1, bottom: 4.5 },
        },
        readings: [reading(12.5, 8.4), reading(6.3, 5.2)],
        confirmedBy: "",
        frozen: false,
        updatedAt: "2026-09-24 09:05",
      },
    ],
  },
  {
    holeId: "ZK-18",
    versions: [
      {
        version: 1,
        reason: "成井登记",
        structure: {
          aquifer: { name: "潜水含水层", top: 4, bottom: 18 },
          screen: { top: 6, bottom: 16 },
          filter: { top: 5, bottom: 17 },
          seal: { top: 1, bottom: 4.5 },
        },
        readings: [reading(8.4, 9.6), reading(7.2, 8.8)],
        confirmedBy: "",
        frozen: false,
        updatedAt: "2026-09-25 15:30",
      },
    ],
  },
  {
    holeId: "ZK-21",
    versions: [
      {
        version: 1,
        reason: "成井登记",
        structure: {
          aquifer: { name: "卵石含水层", top: 8, bottom: 26 },
          screen: { top: 10, bottom: 24 },
          filter: { top: 9, bottom: 25 },
          seal: { top: 2, bottom: 12 },
        },
        readings: [reading(null, null), reading(null, null)],
        confirmedBy: "",
        frozen: false,
        updatedAt: "2026-09-26 11:20",
      },
    ],
  },
];

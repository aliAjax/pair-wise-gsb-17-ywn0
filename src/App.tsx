import { useEffect, useMemo, useState } from "react";
import "./styles.css";

/* ================= 验收标准常量 ================= */

const SAND_RATIO_MIN = 20000; // 含砂量（体积比 1:N）达标线：N ≥ 20000
const TURBIDITY_MAX = 10; // 浊度达标线：≤ 10 NTU
const STORAGE_KEY = "hxwl03-wells-v1";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "岩土钻孔编录 · 成井验收台",
  subtitle:
    "在已有钻孔上登记目标含水层、筛管、滤料与止水段：筛管须落在目标层内，滤料包住筛管且不越出含水层，止水段触碰筛管即报冲突。洗井两次含砂量与浊度达标、班组长确认后冻结验收，修正另建原因版本，台账始终按孔号排列。",
  stack: "React + Vite + TypeScript + CSS",
};

/* ================= 领域模型 ================= */

interface Borehole {
  id: string;
  depth: number; // 孔深 m
  note: string;
}

const BOREHOLES: Borehole[] = [
  { id: "ZK-18", depth: 22.6, note: "粉质黏土为主，中密" },
  { id: "ZK-21", depth: 31.2, note: "卵石层夹中粗砂" },
  { id: "ZK-24", depth: 18.4, note: "强风化泥岩" },
  { id: "ZK-27", depth: 26.0, note: "粉细砂夹黏土透镜体" },
  { id: "ZK-33", depth: 35.5, note: "砂砾卵石，富水" },
];

interface StructureData {
  aquiferName: string; // 目标含水层
  aquiferTop: number; // 含水层顶板 m
  aquiferBottom: number; // 含水层底板 m
  screenTop: number; // 筛管顶 m
  screenBottom: number; // 筛管底 m
  filterTop: number; // 滤料顶 m
  filterBottom: number; // 滤料底 m
  sealTop: number; // 止水段顶 m
  sealBottom: number; // 止水段底 m
}

interface DevRound {
  sandRatio: number | null; // 含砂量体积比 1:N 中的 N
  turbidity: number | null; // 浊度 NTU
}

interface Development {
  rounds: [DevRound, DevRound];
  foreman: string; // 班组长
  confirmed: boolean; // 班组长确认
}

interface Version {
  no: number;
  reason: string; // 新建/修正原因
  createdAt: string;
  structure: StructureData;
  development: Development;
  frozen: boolean;
  frozenAt: string | null;
}

interface Well {
  boreholeId: string;
  versions: Version[];
}

interface StructureForm {
  aquiferName: string;
  aquiferTop: string;
  aquiferBottom: string;
  screenTop: string;
  screenBottom: string;
  filterTop: string;
  filterBottom: string;
  sealTop: string;
  sealBottom: string;
}

/* ================= 工具函数 ================= */

function now() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "—");

/** 孔号自然排序：ZK-2 排在 ZK-18 前，台账与列表始终按孔号排列 */
function compareBorehole(a: string, b: string): number {
  const pa = a.split(/(\d+)/);
  const pb = b.split(/(\d+)/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    if (x === y) continue;
    const nx = Number(x);
    const ny = Number(y);
    if (x !== "" && y !== "" && Number.isFinite(nx) && Number.isFinite(ny)) {
      return nx - ny;
    }
    return x.localeCompare(y, "zh-CN");
  }
  return 0;
}

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

function blankStructureForm(): StructureForm {
  return {
    aquiferName: "",
    aquiferTop: "",
    aquiferBottom: "",
    screenTop: "",
    screenBottom: "",
    filterTop: "",
    filterBottom: "",
    sealTop: "",
    sealBottom: "",
  };
}

function blankDevelopment(): Development {
  return {
    rounds: [
      { sandRatio: null, turbidity: null },
      { sandRatio: null, turbidity: null },
    ],
    foreman: "",
    confirmed: false,
  };
}

function cloneDev(d: Development): Development {
  return {
    rounds: [{ ...d.rounds[0] }, { ...d.rounds[1] }],
    foreman: d.foreman,
    confirmed: d.confirmed,
  };
}

function dataFromForm(f: StructureForm): StructureData {
  return {
    aquiferName: f.aquiferName.trim(),
    aquiferTop: num(f.aquiferTop),
    aquiferBottom: num(f.aquiferBottom),
    screenTop: num(f.screenTop),
    screenBottom: num(f.screenBottom),
    filterTop: num(f.filterTop),
    filterBottom: num(f.filterBottom),
    sealTop: num(f.sealTop),
    sealBottom: num(f.sealBottom),
  };
}

function formFromData(s: StructureData): StructureForm {
  return {
    aquiferName: s.aquiferName,
    aquiferTop: String(s.aquiferTop),
    aquiferBottom: String(s.aquiferBottom),
    screenTop: String(s.screenTop),
    screenBottom: String(s.screenBottom),
    filterTop: String(s.filterTop),
    filterBottom: String(s.filterBottom),
    sealTop: String(s.sealTop),
    sealBottom: String(s.sealBottom),
  };
}

/* ================= 结构校验 ================= */

interface Check {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

function validateStructure(s: StructureData, depth: number): Check[] {
  const segOk = (t: number, b: number) =>
    Number.isFinite(t) && Number.isFinite(b) && t >= 0 && b > t && b <= depth;
  const aqOk = segOk(s.aquiferTop, s.aquiferBottom);
  const scOk = segOk(s.screenTop, s.screenBottom);
  const flOk = segOk(s.filterTop, s.filterBottom);
  const slOk = segOk(s.sealTop, s.sealBottom);

  const screenInAquifer =
    aqOk && scOk && s.aquiferTop <= s.screenTop && s.screenBottom <= s.aquiferBottom;
  const filterWrapsScreen =
    flOk && scOk && s.filterTop <= s.screenTop && s.filterBottom >= s.screenBottom;
  const filterInAquifer =
    aqOk && flOk && s.filterTop >= s.aquiferTop && s.filterBottom <= s.aquiferBottom;
  const sealTouchesScreen =
    slOk && scOk && s.sealTop <= s.screenBottom && s.sealBottom >= s.screenTop;

  return [
    {
      id: "aquifer",
      label: "目标含水层已命名且段深有效",
      pass: s.aquiferName !== "" && aqOk,
      detail: aqOk
        ? `含水层 ${fmt(s.aquiferTop)}–${fmt(s.aquiferBottom)}m`
        : `段深须在 0–${depth.toFixed(1)}m 内且顶板浅于底板`,
    },
    {
      id: "screen",
      label: "筛管段深有效",
      pass: scOk,
      detail: scOk
        ? `筛管 ${fmt(s.screenTop)}–${fmt(s.screenBottom)}m`
        : `段深须在 0–${depth.toFixed(1)}m 内且顶浅于底`,
    },
    {
      id: "filter",
      label: "滤料段深有效",
      pass: flOk,
      detail: flOk
        ? `滤料 ${fmt(s.filterTop)}–${fmt(s.filterBottom)}m`
        : `段深须在 0–${depth.toFixed(1)}m 内且顶浅于底`,
    },
    {
      id: "seal",
      label: "止水段深有效",
      pass: slOk,
      detail: slOk
        ? `止水 ${fmt(s.sealTop)}–${fmt(s.sealBottom)}m`
        : `段深须在 0–${depth.toFixed(1)}m 内且顶浅于底`,
    },
    {
      id: "screen-in-aquifer",
      label: "筛管落在目标含水层内",
      pass: screenInAquifer,
      detail: screenInAquifer
        ? "筛管完整位于目标层区间"
        : `筛管 ${fmt(s.screenTop)}–${fmt(s.screenBottom)}m 未落入含水层 ${fmt(
            s.aquiferTop
          )}–${fmt(s.aquiferBottom)}m`,
    },
    {
      id: "filter-wraps",
      label: "滤料包住筛管",
      pass: filterWrapsScreen,
      detail: filterWrapsScreen
        ? "滤料段完整覆盖筛管段"
        : `滤料 ${fmt(s.filterTop)}–${fmt(s.filterBottom)}m 未完全覆盖筛管 ${fmt(
            s.screenTop
          )}–${fmt(s.screenBottom)}m`,
    },
    {
      id: "filter-in-aquifer",
      label: "滤料未越过含水层",
      pass: filterInAquifer,
      detail: filterInAquifer
        ? "滤料段未越出目标层边界"
        : `滤料 ${fmt(s.filterTop)}–${fmt(s.filterBottom)}m 越出含水层 ${fmt(
            s.aquiferTop
          )}–${fmt(s.aquiferBottom)}m`,
    },
    {
      id: "seal-screen",
      label: "止水段与筛管无触碰",
      pass: slOk && scOk ? !sealTouchesScreen : false,
      detail: sealTouchesScreen
        ? `冲突：止水段 ${fmt(s.sealTop)}–${fmt(s.sealBottom)}m 碰到筛管 ${fmt(
            s.screenTop
          )}–${fmt(s.screenBottom)}m`
        : "止水段与筛管互不接触",
    },
  ];
}

/* ================= 洗井校验 ================= */

function roundRecorded(r: DevRound) {
  return r.sandRatio !== null && r.turbidity !== null;
}

function roundPass(r: DevRound) {
  return (
    roundRecorded(r) &&
    (r.sandRatio as number) >= SAND_RATIO_MIN &&
    (r.turbidity as number) <= TURBIDITY_MAX
  );
}

/* ================= 示例与持久化 ================= */

function seedWells(): Well[] {
  return [
    {
      boreholeId: "ZK-21",
      versions: [
        {
          no: 1,
          reason: "首次登记",
          createdAt: "2026-09-25 09:20:00",
          structure: {
            aquiferName: "第Ⅱ承压含水层",
            aquiferTop: 24.0,
            aquiferBottom: 31.0,
            screenTop: 24.5,
            screenBottom: 30.5,
            filterTop: 24.0,
            filterBottom: 31.0,
            sealTop: 20.5,
            sealBottom: 23.5,
          },
          development: {
            rounds: [
              { sandRatio: 26000, turbidity: 6.2 },
              { sandRatio: 32000, turbidity: 4.8 },
            ],
            foreman: "王建国",
            confirmed: true,
          },
          frozen: true,
          frozenAt: "2026-09-26 16:40:00",
        },
      ],
    },
    {
      boreholeId: "ZK-24",
      versions: [
        {
          no: 1,
          reason: "首次登记",
          createdAt: "2026-09-26 10:05:00",
          structure: {
            aquiferName: "潜水含水层",
            aquiferTop: 8.0,
            aquiferBottom: 14.0,
            screenTop: 9.0,
            screenBottom: 13.5,
            filterTop: 8.5,
            filterBottom: 14.2,
            sealTop: 12.8,
            sealBottom: 14.0,
          },
          development: {
            rounds: [
              { sandRatio: 12000, turbidity: 14.5 },
              { sandRatio: null, turbidity: null },
            ],
            foreman: "",
            confirmed: false,
          },
          frozen: false,
          frozenAt: null,
        },
      ],
    },
  ];
}

function loadWells(): Well[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Well[];
  } catch {
    /* 忽略损坏缓存，回退示例数据 */
  }
  return seedWells();
}

/* ================= 展示组件 ================= */

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger", "status-ok"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function Schematic({ s, depth }: { s: StructureData; depth: number }) {
  const band = (top: number, bottom: number, cls: string, label: string) => {
    if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
    const t = Math.max(0, Math.min(depth, top));
    const b = Math.max(0, Math.min(depth, bottom));
    return (
      <div
        className={`band ${cls}`}
        style={{ top: `${(t / depth) * 100}%`, height: `${((b - t) / depth) * 100}%` }}
        title={`${label} ${fmt(top)}–${fmt(bottom)}m`}
      >
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div className="schematic">
      <div className="well-column">
        <span className="depth-mark top">0m</span>
        <span className="depth-mark bottom">{depth.toFixed(1)}m</span>
        {band(s.aquiferTop, s.aquiferBottom, "band-aquifer", "含水层")}
        {band(s.filterTop, s.filterBottom, "band-filter", "滤料")}
        {band(s.sealTop, s.sealBottom, "band-seal", "止水")}
        {band(s.screenTop, s.screenBottom, "band-screen", "筛管")}
      </div>
      <ul className="legend">
        <li>
          <i className="band-aquifer" />
          目标含水层 {fmt(s.aquiferTop)}–{fmt(s.aquiferBottom)}m
        </li>
        <li>
          <i className="band-screen" />
          筛管 {fmt(s.screenTop)}–{fmt(s.screenBottom)}m
        </li>
        <li>
          <i className="band-filter" />
          滤料 {fmt(s.filterTop)}–{fmt(s.filterBottom)}m
        </li>
        <li>
          <i className="band-seal" />
          止水 {fmt(s.sealTop)}–{fmt(s.sealBottom)}m
        </li>
      </ul>
    </div>
  );
}

/* ================= 主应用 ================= */

function App() {
  const [wells, setWells] = useState<Well[]>(loadWells);
  const sortedBoreholes = useMemo(
    () => [...BOREHOLES].sort((a, b) => compareBorehole(a.id, b.id)),
    []
  );
  const [selectedId, setSelectedId] = useState(sortedBoreholes[0].id);
  const [form, setForm] = useState<StructureForm>(blankStructureForm);
  const [dev, setDev] = useState<Development>(blankDevelopment);
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wells));
  }, [wells]);

  const borehole = BOREHOLES.find((b) => b.id === selectedId) ?? sortedBoreholes[0];
  const well = wells.find((w) => w.boreholeId === selectedId);
  const current = well ? well.versions[well.versions.length - 1] : undefined;
  const frozen = current?.frozen ?? false;

  // 切换钻孔时装载该孔当前版本；未登记则给空白表单
  useEffect(() => {
    const w = wells.find((x) => x.boreholeId === selectedId);
    const v = w ? w.versions[w.versions.length - 1] : undefined;
    setForm(v ? formFromData(v.structure) : blankStructureForm());
    setDev(v ? cloneDev(v.development) : blankDevelopment());
    setReopening(false);
    setReason("");
    // 仅在切换钻孔时同步，保存/冻结由各自处理器显式回写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const structure = dataFromForm(form);
  const checks = useMemo(
    () => validateStructure(structure, borehole.depth),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, form]
  );
  const errors = checks.filter((c) => !c.pass);

  const blockers: string[] = [];
  if (!well) blockers.push("尚未登记成井结构");
  if (errors.length > 0) blockers.push(`结构校验 ${errors.length} 项未通过`);
  dev.rounds.forEach((r, i) => {
    if (!roundRecorded(r)) blockers.push(`第${i + 1}次洗井未录入`);
    else if (!roundPass(r)) blockers.push(`第${i + 1}次洗井未达标`);
  });
  if (!dev.foreman.trim()) blockers.push("未填写班组长");
  else if (!dev.confirmed) blockers.push("班组长未确认");
  const canFreeze = !!well && !frozen && blockers.length === 0;

  const dirty =
    !!current &&
    (JSON.stringify(structure) !== JSON.stringify(current.structure) ||
      JSON.stringify(dev) !== JSON.stringify(current.development));

  function saveAll() {
    const s = dataFromForm(form);
    const d = cloneDev(dev);
    setWells((prev) => {
      const idx = prev.findIndex((w) => w.boreholeId === selectedId);
      if (idx === -1) {
        return [
          ...prev,
          {
            boreholeId: selectedId,
            versions: [
              {
                no: 1,
                reason: "首次登记",
                createdAt: now(),
                structure: s,
                development: d,
                frozen: false,
                frozenAt: null,
              },
            ],
          },
        ];
      }
      return prev.map((w, i) =>
        i !== idx
          ? w
          : {
              ...w,
              versions: w.versions.map((v, vi) =>
                vi === w.versions.length - 1 ? { ...v, structure: s, development: d } : v
              ),
            }
      );
    });
  }

  function freeze() {
    if (!canFreeze) return;
    if (
      !window.confirm(
        `确认冻结 ${selectedId} 当前版本（v${current?.no}）？冻结后修正须另建原因版本。`
      )
    )
      return;
    const s = dataFromForm(form);
    const d = cloneDev(dev);
    setWells((prev) =>
      prev.map((w) =>
        w.boreholeId !== selectedId
          ? w
          : {
              ...w,
              versions: w.versions.map((v, vi) =>
                vi === w.versions.length - 1
                  ? { ...v, structure: s, development: d, frozen: true, frozenAt: now() }
                  : v
              ),
            }
      )
    );
  }

  function reopen() {
    if (!current || !reason.trim()) return;
    const s = { ...current.structure };
    const d = cloneDev(current.development);
    setWells((prev) =>
      prev.map((w) =>
        w.boreholeId !== selectedId
          ? w
          : {
              ...w,
              versions: [
                ...w.versions,
                {
                  no: w.versions.length + 1,
                  reason: reason.trim(),
                  createdAt: now(),
                  structure: s,
                  development: d,
                  frozen: false,
                  frozenAt: null,
                },
              ],
            }
      )
    );
    setForm(formFromData(s));
    setDev(cloneDev(d));
    setReopening(false);
    setReason("");
  }

  function updateField(key: keyof StructureForm, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function updateRound(idx: 0 | 1, patch: Partial<DevRound>) {
    setDev((d) => {
      const rounds: [DevRound, DevRound] = [{ ...d.rounds[0] }, { ...d.rounds[1] }];
      rounds[idx] = { ...rounds[idx], ...patch };
      return { ...d, rounds };
    });
  }

  /* ---------- 台账与指标（始终按孔号排列） ---------- */

  const ledger = useMemo(
    () => [...wells].sort((a, b) => compareBorehole(a.boreholeId, b.boreholeId)),
    [wells]
  );

  const frozenCount = wells.filter((w) => w.versions[w.versions.length - 1].frozen).length;
  const conflictCount = wells.filter((w) => {
    const v = w.versions[w.versions.length - 1];
    const b = BOREHOLES.find((x) => x.id === w.boreholeId);
    return b ? validateStructure(v.structure, b.depth).some((c) => !c.pass) : false;
  }).length;

  const metrics = [
    { label: "在册钻孔", value: String(BOREHOLES.length) },
    { label: "成井登记", value: String(wells.length) },
    { label: "已验收冻结", value: String(frozenCount) },
    { label: "结构冲突待整改", value: String(conflictCount) },
  ];

  const depthFields: { key: keyof StructureForm; label: string }[] = [
    { key: "aquiferTop", label: "含水层顶板 (m)" },
    { key: "aquiferBottom", label: "含水层底板 (m)" },
    { key: "screenTop", label: "筛管顶 (m)" },
    { key: "screenBottom", label: "筛管底 (m)" },
    { key: "filterTop", label: "滤料顶 (m)" },
    { key: "filterBottom", label: "滤料底 (m)" },
    { key: "sealTop", label: "止水段顶 (m)" },
    { key: "sealBottom", label: "止水段底 (m)" },
  ];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {project.id} · port {project.port}
          </p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
          <span>验收标准</span>
          <strong>
            含砂量 ≤ 1:{SAND_RATIO_MIN}（体积比）· 浊度 ≤ {TURBIDITY_MAX} NTU
          </strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, i) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={i} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>已有钻孔</h2>
          <div className="borehole-list">
            {sortedBoreholes.map((b) => {
              const w = wells.find((x) => x.boreholeId === b.id);
              const v = w ? w.versions[w.versions.length - 1] : undefined;
              return (
                <button
                  key={b.id}
                  className={`borehole-item ${b.id === selectedId ? "active" : ""}`}
                  onClick={() => setSelectedId(b.id)}
                >
                  <strong>{b.id}</strong>
                  <span>
                    孔深 {b.depth.toFixed(1)}m · {b.note}
                  </span>
                  <em className={v ? (v.frozen ? "badge-ok" : "badge-warn") : "badge-muted"}>
                    {v ? (v.frozen ? `已冻结 v${v.no}` : `未验收 v${v.no}`) : "未登记"}
                  </em>
                </button>
              );
            })}
          </div>
          <p className="hint">选择已有钻孔登记或查看成井结构；列表与台账均按孔号排列。</p>
        </aside>

        <div className="main-column">
          {frozen && current && (
            <div className="frozen-banner">
              <span>
                v{current.no} 已冻结 · {current.frozenAt} · 班组长{" "}
                {current.development.foreman}
              </span>
              {!reopening ? (
                <button onClick={() => setReopening(true)}>修正重开（新建版本）</button>
              ) : (
                <span className="reopen-line">
                  <input
                    placeholder="填写修正原因"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button className="primary-action" onClick={reopen} disabled={!reason.trim()}>
                    新建版本
                  </button>
                  <button onClick={() => setReopening(false)}>取消</button>
                </span>
              )}
            </div>
          )}

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>成井结构登记 · {borehole.id}（孔深 {borehole.depth.toFixed(1)}m）</p>
                <h2>目标含水层 / 筛管 / 滤料 / 止水</h2>
              </div>
              {!frozen && (
                <button className="primary-action" onClick={saveAll}>
                  {well ? "保存修改" : "登记成井"}
                </button>
              )}
            </div>

            <div className="structure-grid">
              <div>
                <div className="field-grid">
                  <label className="span-2">
                    <span>目标含水层名称</span>
                    <input
                      placeholder="如：第Ⅰ承压含水层"
                      value={form.aquiferName}
                      disabled={frozen}
                      onChange={(e) => updateField("aquiferName", e.target.value)}
                    />
                  </label>
                  {depthFields.map((f) => (
                    <label key={f.key}>
                      <span>{f.label}</span>
                      <input
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="0.0"
                        value={form[f.key]}
                        disabled={frozen}
                        onChange={(e) => updateField(f.key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>

                <ul className="checks">
                  {checks.map((c) => (
                    <li key={c.id} className={`check ${c.pass ? "pass" : "fail"}`}>
                      <i>{c.pass ? "✓" : "✗"}</i>
                      <div>
                        <strong>{c.label}</strong>
                        <p>{c.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <Schematic s={structure} depth={borehole.depth} />
            </div>
          </section>

          {well && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p>洗井记录与验收冻结 · {borehole.id}</p>
                  <h2>两次含砂量 / 浊度</h2>
                </div>
                {!frozen && (
                  <button className="primary-action" onClick={freeze} disabled={!canFreeze}>
                    冻结验收
                  </button>
                )}
              </div>

              <div className="round-cards">
                {dev.rounds.map((r, i) => {
                  const recorded = roundRecorded(r);
                  const pass = roundPass(r);
                  return (
                    <div key={i} className="round-card">
                      <div className="round-head">
                        <strong>第{i + 1}次洗井</strong>
                        <em
                          className={
                            recorded ? (pass ? "badge-ok" : "badge-danger") : "badge-muted"
                          }
                        >
                          {recorded ? (pass ? "达标" : "未达标") : "未录入"}
                        </em>
                      </div>
                      <label>
                        <span>含砂量（体积比 1 : N，N ≥ {SAND_RATIO_MIN}）</span>
                        <input
                          type="number"
                          min="1"
                          step="1000"
                          placeholder="如 25000"
                          value={r.sandRatio ?? ""}
                          disabled={frozen}
                          onChange={(e) =>
                            updateRound(i as 0 | 1, {
                              sandRatio: Number.isNaN(e.target.valueAsNumber)
                                ? null
                                : e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                      <label>
                        <span>浊度（NTU，≤ {TURBIDITY_MAX}）</span>
                        <input
                          type="number"
                          min="0"
                          step="0.1"
                          placeholder="如 8.5"
                          value={r.turbidity ?? ""}
                          disabled={frozen}
                          onChange={(e) =>
                            updateRound(i as 0 | 1, {
                              turbidity: Number.isNaN(e.target.valueAsNumber)
                                ? null
                                : e.target.valueAsNumber,
                            })
                          }
                        />
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="confirm-line">
                <label className="foreman-field">
                  <span>班组长</span>
                  <input
                    placeholder="班组长姓名"
                    value={dev.foreman}
                    disabled={frozen}
                    onChange={(e) => setDev((d) => ({ ...d, foreman: e.target.value }))}
                  />
                </label>
                <label className="confirm-check">
                  <input
                    type="checkbox"
                    checked={dev.confirmed}
                    disabled={frozen}
                    onChange={(e) => setDev((d) => ({ ...d, confirmed: e.target.checked }))}
                  />
                  班组长已确认两次洗井结果达标
                </label>
              </div>

              {!frozen && blockers.length > 0 && (
                <ul className="blockers">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {!frozen && dirty && <p className="hint">有未保存修改，冻结时将一并写入当前版本。</p>}
            </section>
          )}

          {well && (
            <section className="panel">
              <div className="section-heading">
                <div>
                  <p>版本历史 · {borehole.id}</p>
                  <h2>登记与修正记录</h2>
                </div>
              </div>
              <div className="version-list">
                {[...well.versions].reverse().map((v) => (
                  <div key={v.no} className="version-item">
                    <strong>v{v.no}</strong>
                    <em className={v.frozen ? "badge-ok" : "badge-warn"}>
                      {v.frozen ? "已冻结" : "编辑中"}
                    </em>
                    <span>登记 {v.createdAt}</span>
                    {v.frozen && <span>冻结 {v.frozenAt}</span>}
                    <span>原因：{v.reason}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>按孔号排列</p>
            <h2>成井台账</h2>
          </div>
        </div>
        <div className="record-list">
          {ledger.length === 0 && <p className="hint">尚无成井登记，请先在左侧选择钻孔。</p>}
          {ledger.map((w) => {
            const v = w.versions[w.versions.length - 1];
            const b = BOREHOLES.find((x) => x.id === w.boreholeId);
            const errs = b ? validateStructure(v.structure, b.depth).filter((c) => !c.pass) : [];
            const [r1, r2] = v.development.rounds;
            const roundText = (r: DevRound) =>
              roundRecorded(r) ? `1:${r.sandRatio} / ${r.turbidity}NTU` : "未录";
            return (
              <article key={w.boreholeId} className="ledger-row">
                <div className="ledger-head">
                  <strong>{w.boreholeId}</strong>
                  <em className={v.frozen ? "badge-ok" : "badge-warn"}>
                    {v.frozen ? "已验收 · 冻结" : "未验收"}
                  </em>
                  <span>v{v.no}</span>
                  {errs.length > 0 && <em className="badge-danger">{errs.length} 项冲突</em>}
                  <button className="ledger-load" onClick={() => setSelectedId(w.boreholeId)}>
                    载入查看
                  </button>
                </div>
                <p>
                  结构：{v.structure.aquiferName} {fmt(v.structure.aquiferTop)}–
                  {fmt(v.structure.aquiferBottom)}m · 筛管 {fmt(v.structure.screenTop)}–
                  {fmt(v.structure.screenBottom)}m · 滤料 {fmt(v.structure.filterTop)}–
                  {fmt(v.structure.filterBottom)}m · 止水 {fmt(v.structure.sealTop)}–
                  {fmt(v.structure.sealBottom)}m
                </p>
                <p>
                  洗井：第一次 {roundText(r1)} · 第二次 {roundText(r2)} · 班组长{" "}
                  {v.development.foreman || "—"}
                </p>
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default App;

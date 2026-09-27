import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import WellDiagram from "./WellDiagram";
import {
  Borehole,
  Reading,
  SAND_LIMIT,
  TURBIDITY_LIMIT,
  WellRecord,
  WellStructure,
  WellVersion,
  checkStructure,
  compareHoleId,
  developmentOk,
  freezable,
  latestVersion,
  nowStamp,
  readingOk,
  seedBoreholes,
  seedWells,
  sortWellsByHole,
  statusText,
  wellStatus,
} from "./wellModel";

const project = {
  id: "hxwl-03",
  port: 5103,
  title: "监测井成井验收台",
  subtitle:
    "在已有钻孔上登记目标含水层、筛管、滤料与止水段：结构校验、两次洗井达标并经班组长确认后冻结验收，修正另建原因版本。",
  stack: "React + Vite + TypeScript + CSS",
};

interface FormState {
  aquiferName: string;
  aquiferTop: string;
  aquiferBottom: string;
  screenTop: string;
  screenBottom: string;
  filterTop: string;
  filterBottom: string;
  sealTop: string;
  sealBottom: string;
  sand1: string;
  turb1: string;
  sand2: string;
  turb2: string;
  confirmedBy: string;
}

const blankForm = (): FormState => ({
  aquiferName: "",
  aquiferTop: "",
  aquiferBottom: "",
  screenTop: "",
  screenBottom: "",
  filterTop: "",
  filterBottom: "",
  sealTop: "",
  sealBottom: "",
  sand1: "",
  turb1: "",
  sand2: "",
  turb2: "",
  confirmedBy: "",
});

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));
const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));
const fmt = (n: number) => n.toFixed(1);
const fmtOrDash = (n: number | null) => (n === null ? "—" : String(n));

function formFromVersion(v: WellVersion): FormState {
  const r = (x: number | null) => (x === null ? "" : String(x));
  return {
    aquiferName: v.structure.aquifer.name,
    aquiferTop: String(v.structure.aquifer.top),
    aquiferBottom: String(v.structure.aquifer.bottom),
    screenTop: String(v.structure.screen.top),
    screenBottom: String(v.structure.screen.bottom),
    filterTop: String(v.structure.filter.top),
    filterBottom: String(v.structure.filter.bottom),
    sealTop: String(v.structure.seal.top),
    sealBottom: String(v.structure.seal.bottom),
    sand1: r(v.readings[0].sand),
    turb1: r(v.readings[0].turbidity),
    sand2: r(v.readings[1].sand),
    turb2: r(v.readings[1].turbidity),
    confirmedBy: v.confirmedBy,
  };
}

function structureFromForm(f: FormState): WellStructure {
  return {
    aquifer: { name: f.aquiferName.trim() || "目标含水层", top: num(f.aquiferTop), bottom: num(f.aquiferBottom) },
    screen: { top: num(f.screenTop), bottom: num(f.screenBottom) },
    filter: { top: num(f.filterTop), bottom: num(f.filterBottom) },
    seal: { top: num(f.sealTop), bottom: num(f.sealBottom) },
  };
}

function readingsFromForm(f: FormState): [Reading, Reading] {
  return [
    { sand: numOrNull(f.sand1), turbidity: numOrNull(f.turb1) },
    { sand: numOrNull(f.sand2), turbidity: numOrNull(f.turb2) },
  ];
}

function ReadingChip({ reading }: { reading: Reading }) {
  const empty = reading.sand === null && reading.turbidity === null;
  const ok = readingOk(reading);
  return (
    <span className={"reading-chip " + (empty ? "rc-wait" : ok ? "rc-ok" : "rc-bad")}>
      {empty ? "待记录" : ok ? "达标" : "未达标"}
    </span>
  );
}

function MetricCard({ label, value, index }: { label: string; value: string; index: number }) {
  const colors = ["status-ok", "status-watch", "status-danger"];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <i className={colors[index % colors.length]} />
    </article>
  );
}

function App() {
  const [boreholes] = useState<Borehole[]>(seedBoreholes);
  const [wells, setWells] = useState<WellRecord[]>(seedWells);
  const [selectedHole, setSelectedHole] = useState<string>(seedBoreholes[0].id);
  const [form, setForm] = useState<FormState>(blankForm);
  const [reopenReasons, setReopenReasons] = useState<Record<string, string>>({});

  const hole: Borehole = boreholes.find((b) => b.id === selectedHole) ?? boreholes[0];
  const selectedWell = wells.find((w) => w.holeId === selectedHole);
  const selectedVersion = selectedWell ? latestVersion(selectedWell) : undefined;
  const isFrozen = Boolean(selectedVersion?.frozen);

  // 选孔或当前版本变化时，把最新版本载入表单
  const syncKey = `${selectedHole}|${selectedVersion ? `${selectedVersion.version}|${selectedVersion.updatedAt}` : "new"}`;
  useEffect(() => {
    setForm(selectedVersion ? formFromVersion(selectedVersion) : blankForm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncKey]);

  const structure = structureFromForm(form);
  const readings = readingsFromForm(form);
  const issues = checkStructure(structure, hole.depth);
  const canFreeze =
    !isFrozen &&
    freezable(
      { version: 0, reason: "", structure, readings, confirmedBy: form.confirmedBy, frozen: false, updatedAt: "" },
      hole.depth
    );

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  /** 把表单写回当前版本；freeze 为 true 时同时冻结 */
  function persistCurrent(freeze: boolean) {
    const nextStructure = structureFromForm(form);
    const nextReadings = readingsFromForm(form);
    const confirmedBy = form.confirmedBy.trim();
    setWells((prev) => {
      const existing = prev.find((w) => w.holeId === selectedHole);
      if (!existing) {
        const v: WellVersion = {
          version: 1,
          reason: "成井登记",
          structure: nextStructure,
          readings: nextReadings,
          confirmedBy,
          frozen: freeze,
          updatedAt: nowStamp(),
        };
        return [...prev, { holeId: selectedHole, versions: [v] }];
      }
      const last = latestVersion(existing);
      if (last.frozen) return prev; // 冻结版本不可改
      const versions = existing.versions.slice();
      versions[versions.length - 1] = {
        ...last,
        structure: nextStructure,
        readings: nextReadings,
        confirmedBy,
        frozen: freeze || last.frozen,
        updatedAt: nowStamp(),
      };
      return prev.map((w) => (w.holeId === selectedHole ? { ...w, versions } : w));
    });
  }

  /** 冻结版本按原因重开：另建一个可编辑的新版本 */
  function reopenWell(holeId: string) {
    const reason = (reopenReasons[holeId] ?? "").trim();
    if (!reason) return;
    setWells((prev) =>
      prev.map((w) => {
        if (w.holeId !== holeId) return w;
        const last = latestVersion(w);
        if (!last.frozen) return w;
        const s = last.structure;
        const v: WellVersion = {
          version: last.version + 1,
          reason,
          structure: {
            aquifer: { ...s.aquifer },
            screen: { ...s.screen },
            filter: { ...s.filter },
            seal: { ...s.seal },
          },
          readings: [{ ...last.readings[0] }, { ...last.readings[1] }],
          confirmedBy: "",
          frozen: false,
          updatedAt: nowStamp(),
        };
        return { ...w, versions: [...w.versions, v] };
      })
    );
    setReopenReasons((prev) => ({ ...prev, [holeId]: "" }));
    setSelectedHole(holeId);
  }

  const depthOf = (holeId: string) => boreholes.find((b) => b.id === holeId)?.depth ?? 0;
  const sortedWells = useMemo(() => sortWellsByHole(wells), [wells]);
  const sortedHoles = useMemo(() => boreholes.slice().sort((a, b) => compareHoleId(a.id, b.id)), [boreholes]);

  const frozenCount = wells.filter((w) => latestVersion(w).frozen).length;
  const metrics = [
    { label: "在册钻孔", value: String(boreholes.length) },
    { label: "已登记成井", value: String(wells.length) },
    { label: "已冻结验收", value: String(frozenCount) },
    { label: "待验收井", value: String(wells.length - frozenCount) },
  ];

  const depthField = (label: string, topKey: keyof FormState, bottomKey: keyof FormState) => (
    <div className="depth-pair">
      <label>
        <span>{label}顶深 (m)</span>
        <input type="number" step="0.1" min="0" value={form[topKey]} onChange={set(topKey)} disabled={isFrozen} />
      </label>
      <label>
        <span>{label}底深 (m)</span>
        <input type="number" step="0.1" min="0" value={form[bottomKey]} onChange={set(bottomKey)} disabled={isFrozen} />
      </label>
    </div>
  );

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">{project.id} · port {project.port}</p>
          <h1>{project.title}</h1>
          <p className="subtitle">{project.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{project.stack}</strong>
          <span>验收阈值</span>
          <strong>含砂量 ≤ {SAND_LIMIT} mg/L · 浊度 ≤ {TURBIDITY_LIMIT} NTU</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, index) => (
          <MetricCard key={m.label} label={m.label} value={m.value} index={index} />
        ))}
      </section>

      <section className="workspace">
        <aside className="panel narrow">
          <h2>钻孔册（按孔号）</h2>
          <div className="borehole-list">
            {sortedHoles.map((b) => {
              const well = wells.find((w) => w.holeId === b.id);
              const st = well ? wellStatus(well, b.depth) : undefined;
              return (
                <button
                  key={b.id}
                  className={"borehole-item" + (b.id === selectedHole ? " active" : "")}
                  onClick={() => setSelectedHole(b.id)}
                >
                  <strong>{b.id}</strong>
                  <span>{fmt(b.depth)}m · {b.strata} · {b.note}</span>
                  <em className={st ? `status-chip st-${st}` : "status-chip st-none"}>
                    {st ? statusText[st] : "未登记"}
                  </em>
                </button>
              );
            })}
          </div>
          <div className="threshold-box">
            <h3>冻结条件</h3>
            <p>结构五条校验全部通过；两次洗井含砂量、浊度均达标；班组长签字确认。冻结后如需修正，在台账按原因重开新版本。</p>
          </div>
        </aside>

        <section className="panel">
          <div className="section-heading">
            <div>
              <p>成井登记台</p>
              <h2>
                {hole.id} · 孔深 {fmt(hole.depth)}m · {hole.strata}
                {selectedVersion && (
                  <em className={`status-chip st-${wellStatus(selectedWell!, hole.depth)}`}>
                    {statusText[wellStatus(selectedWell!, hole.depth)]} · v{selectedVersion.version}
                  </em>
                )}
              </h2>
            </div>
            <div className="action-row">
              <button className="primary-action" onClick={() => persistCurrent(false)} disabled={isFrozen}>
                {selectedWell ? "保存修改" : "登记成井"}
              </button>
              <button
                className="freeze-action"
                onClick={() => persistCurrent(true)}
                disabled={!canFreeze}
                title={canFreeze ? "冻结后记录不可改，修正需另建版本" : "需结构合规、两次洗井达标且班组长确认"}
              >
                冻结验收
              </button>
            </div>
          </div>

          {isFrozen && selectedVersion && (
            <p className="frozen-banner">
              当前版本 v{selectedVersion.version} 已冻结（{selectedVersion.confirmedBy} · {selectedVersion.updatedAt}），
              如需修正请在下方验收台账填写原因后重开新版本。
            </p>
          )}

          <div className="form-columns">
            <div className="form-main">
              <div className="form-group">
                <h3>目标含水层</h3>
                <label>
                  <span>含水层名称</span>
                  <input value={form.aquiferName} onChange={set("aquiferName")} placeholder="如：第Ⅰ承压含水层" disabled={isFrozen} />
                </label>
                {depthField("含水层", "aquiferTop", "aquiferBottom")}
              </div>

              <div className="form-group">
                <h3>筛管段</h3>
                {depthField("筛管", "screenTop", "screenBottom")}
              </div>

              <div className="form-group">
                <h3>滤料段</h3>
                {depthField("滤料", "filterTop", "filterBottom")}
              </div>

              <div className="form-group">
                <h3>止水段</h3>
                {depthField("止水", "sealTop", "sealBottom")}
              </div>

              <div className="form-group">
                <h3>洗井记录（含砂量 mg/L · 浊度 NTU）</h3>
                {[0, 1].map((i) => {
                  const sandKey = (i === 0 ? "sand1" : "sand2") as keyof FormState;
                  const turbKey = (i === 0 ? "turb1" : "turb2") as keyof FormState;
                  return (
                    <div className="depth-pair reading-row" key={i}>
                      <label>
                        <span>第{i === 0 ? "一" : "二"}次含砂量</span>
                        <input type="number" step="0.1" min="0" value={form[sandKey]} onChange={set(sandKey)} disabled={isFrozen} />
                      </label>
                      <label>
                        <span>第{i === 0 ? "一" : "二"}次浊度</span>
                        <input type="number" step="0.1" min="0" value={form[turbKey]} onChange={set(turbKey)} disabled={isFrozen} />
                      </label>
                      <ReadingChip reading={readings[i]} />
                    </div>
                  );
                })}
              </div>

              <div className="form-group">
                <h3>班组长确认</h3>
                <label>
                  <span>确认人签字</span>
                  <input value={form.confirmedBy} onChange={set("confirmedBy")} placeholder="班组长姓名" disabled={isFrozen} />
                </label>
              </div>
            </div>

            <div className="form-side">
              <WellDiagram structure={structure} holeDepth={hole.depth} />
              <div className="issue-panel">
                <h3>结构校验</h3>
                <ul className="issue-list">
                  {issues.map((issue) => (
                    <li key={issue.id} className={issue.ok ? "ok" : "bad"}>
                      <b>{issue.ok ? "✓" : "✗"}</b>
                      <div>
                        <span>{issue.label}</span>
                        <small>{issue.detail}</small>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className={"dev-summary " + (developmentOk(readings) ? "ok" : "")}>
                  洗井{developmentOk(readings) ? "两次均达标" : "尚未两次均达标"}
                  {form.confirmedBy.trim() ? ` · ${form.confirmedBy.trim()}已确认` : " · 班组长未确认"}
                </p>
              </div>
            </div>
          </div>
        </section>
      </section>

      <section className="records panel">
        <div className="section-heading">
          <div>
            <p>按孔号排列</p>
            <h2>验收台账（{sortedWells.length} 口）</h2>
          </div>
        </div>
        <div className="record-list">
          {sortedWells.map((well) => {
            const v = latestVersion(well);
            const depth = depthOf(well.holeId);
            const st = wellStatus(well, depth);
            const failed = checkStructure(v.structure, depth).filter((i) => !i.ok);
            const s = v.structure;
            return (
              <article key={well.holeId} className="record-card well-card">
                <div className="well-card-head">
                  <h3>{well.holeId}</h3>
                  <em className={`status-chip st-${st}`}>{statusText[st]}</em>
                  <span className="version-tag">当前 v{v.version}</span>
                  <button className="link-btn" onClick={() => setSelectedHole(well.holeId)}>
                    载入登记台
                  </button>
                </div>

                <p className="well-meta">
                  {s.aquifer.name} {fmt(s.aquifer.top)}–{fmt(s.aquifer.bottom)}m · 筛管 {fmt(s.screen.top)}–{fmt(s.screen.bottom)}m ·
                  滤料 {fmt(s.filter.top)}–{fmt(s.filter.bottom)}m · 止水 {fmt(s.seal.top)}–{fmt(s.seal.bottom)}m
                </p>

                {failed.length > 0 ? (
                  <ul className="fail-list">
                    {failed.map((f) => (
                      <li key={f.id}>✗ {f.label}：{f.detail}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="pass-line">✓ 结构校验通过</p>
                )}

                <p className="well-meta">
                  洗井① 含砂量 {fmtOrDash(v.readings[0].sand)} · 浊度 {fmtOrDash(v.readings[0].turbidity)}{" "}
                  <ReadingChip reading={v.readings[0]} />　洗井② 含砂量 {fmtOrDash(v.readings[1].sand)} · 浊度{" "}
                  {fmtOrDash(v.readings[1].turbidity)} <ReadingChip reading={v.readings[1]} />
                </p>
                <p className="well-meta">
                  班组长确认：{v.confirmedBy || "未确认"} · 更新于 {v.updatedAt}
                </p>

                <ul className="version-list">
                  {well.versions.map((ver) => (
                    <li key={ver.version}>
                      v{ver.version} · {ver.reason} · {ver.frozen ? "已冻结" : "编辑中"} · {ver.updatedAt}
                    </li>
                  ))}
                </ul>

                {v.frozen && (
                  <div className="reopen-row">
                    <input
                      placeholder="修正原因（另建新版本）"
                      value={reopenReasons[well.holeId] ?? ""}
                      onChange={(e) => setReopenReasons((prev) => ({ ...prev, [well.holeId]: e.target.value }))}
                    />
                    <button onClick={() => reopenWell(well.holeId)} disabled={!(reopenReasons[well.holeId] ?? "").trim()}>
                      重开新版本
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </section>
    </main>
  );
}

export default App;

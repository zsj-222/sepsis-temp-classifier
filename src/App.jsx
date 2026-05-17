import { useMemo, useState } from "react";
import "./App.css";

const ORAL_MEAN = 36.99849987;

const SITE_OFFSETS = {
  颞温: ORAL_MEAN - 36.68074579,
  鼓膜温: ORAL_MEAN - 36.68493572,
  腋温: ORAL_MEAN - 36.74558987,
  血温: ORAL_MEAN - 36.91808807,
  食管温: ORAL_MEAN - 36.96569889,
  口温: 0,
  直肠温: ORAL_MEAN - 37.13131609,
};

const SITE_OPTIONS = ["颞温", "鼓膜温", "腋温", "血温", "食管温", "口温", "直肠温"];

// 整体标准化参数
const OVERALL_MEAN = 37.09379897;
const OVERALL_STD = 0.69606188;

// 这里把 mortality28 改成数值型，便于加权计算
const TRAJECTORIES = [
  {
    code: 1,
    name: "低体温组",
    a: -0.000078,
    b: 0.010543,
    c: -1.522477,
    mortality28: 28.6,
  },
  {
    code: 2,
    name: "低热组",
    a: -0.000322,
    b: 0.029391,
    c: -0.163585,
    mortality28: 17.9,
  },
  {
    code: 3,
    name: "常温组",
    a: -0.000034,
    b: 0.002003,
    c: -0.415289,
    mortality28: 17.5,
  },
  {
    code: 4,
    name: "高热快速下降组",
    a: 0.000363,
    b: -0.045280,
    c: 1.258603,
    mortality28: 13.4,
  },
  {
    code: 5,
    name: "持续高热组",
    a: -0.000172,
    b: 0.010583,
    c: 1.140373,
    mortality28: 20.7,
  },
];

function format8(value) {
  return Number(value).toFixed(8);
}

function format2(value) {
  return Number(value).toFixed(2);
}

function formatPercent(value, digits = 1) {
  return `${Number(value).toFixed(digits)}%`;
}

function calculateRss(a, b, c, timeList, measurementList) {
  if (timeList.length !== measurementList.length) {
    throw new Error("时间列表和测量值列表长度不一致");
  }

  let rss = 0;
  for (let i = 0; i < timeList.length; i += 1) {
    const t = Number(timeList[i]);
    const yMeasured = Number(measurementList[i]);
    const yPredicted = a * t ** 2 + b * t + c;
    const residual = yMeasured - yPredicted;
    rss += residual ** 2;
  }
  return rss;
}

// 第一步：统一为口腔等效体温
function normalizeTemperature(temperature, site) {
  const offset = SITE_OFFSETS[site] ?? 0;
  return Number((Number(temperature) + offset).toFixed(8));
}

// 第二步：整体标准化
function standardizeTemperature(temperature) {
  return Number(((Number(temperature) - OVERALL_MEAN) / OVERALL_STD).toFixed(8));
}

// 根据 RSS 反比计算各亚表型权重
function calculateSubtypeWeights(rssValues) {
  const EPS = 1e-12;

  const inverseRssList = rssValues.map((item) => 1 / Math.max(item.rss, EPS));
  const inverseRssSum = inverseRssList.reduce((sum, value) => sum + value, 0);

  return rssValues.map((item, index) => ({
    ...item,
    weight: inverseRssSum > 0 ? inverseRssList[index] / inverseRssSum : 0,
  }));
}

function classifyTrajectory(records) {
  const timeList = records.map((item) => Number(item.time));
  const measurementList = records.map((item) => Number(item.standardizedTemperature));

  const rssValues = TRAJECTORIES.map((traj) => ({
    code: traj.code,
    name: traj.name,
    mortality28: traj.mortality28,
    rss: calculateRss(traj.a, traj.b, traj.c, timeList, measurementList),
  }));

  const best = rssValues.reduce((min, cur) => (cur.rss < min.rss ? cur : min), rssValues[0]);

  const weightedRssValues = calculateSubtypeWeights(rssValues);

  const weightedMortality28 = weightedRssValues.reduce(
    (sum, item) => sum + item.weight * item.mortality28,
    0
  );

  return {
    best,
    rssValues,
    weightedRssValues,
    weightedMortality28,
  };
}

function computeMissRate(sortedRecords) {
  const temp = sortedRecords.map((item) => item.standardizedTemperature);
  const time = sortedRecords.map((item) => Number(item.time));

  let missNum = 0;
  for (let i = 1; i < time.length; i += 1) {
    const diff = time[i] - time[i - 1];
    if (diff > 4) {
      missNum += Math.floor((diff - 4) / 4);
    }
  }

  const missRate = temp.length > 0 ? missNum / temp.length : 0;
  return { missNum, missRate };
}

function MiniCurveChart({ records }) {
  if (!records || records.length === 0) {
    return <div className="chart-empty">暂无体温曲线数据</div>;
  }

  const width = 360;
  const height = 220;
  const padding = { top: 20, right: 20, bottom: 42, left: 48 };

  const times = records.map((d) => Number(d.time));
  const temps = records.map((d) => Number(d.rawTemperature));

  const minX = Math.min(...times);
  const maxX = Math.max(...times);
  const minTempRaw = Math.min(...temps);
  const maxTempRaw = Math.max(...temps);

  const yPadding = Math.max(0.3, (maxTempRaw - minTempRaw) * 0.15 || 0.5);
  const minY = minTempRaw - yPadding;
  const maxY = maxTempRaw + yPadding;

  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xScale = (x) => {
    if (maxX === minX) return padding.left + plotWidth / 2;
    return padding.left + ((x - minX) / (maxX - minX)) * plotWidth;
  };

  const yScale = (y) => {
    if (maxY === minY) return padding.top + plotHeight / 2;
    return padding.top + ((maxY - y) / (maxY - minY)) * plotHeight;
  };

  const polylinePoints = records
    .map((d) => `${xScale(Number(d.time))},${yScale(Number(d.rawTemperature))}`)
    .join(" ");

  const yTicks = 4;
  const xTicks = 4;

  return (
    <div className="mini-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="mini-chart">
        <rect x="0" y="0" width={width} height={height} rx="18" className="chart-bg" />

        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const value = minY + ((maxY - minY) / yTicks) * i;
          const y = yScale(value);
          return (
            <g key={`y-${i}`}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                className="grid-line"
              />
              <text x={padding.left - 10} y={y + 4} textAnchor="end" className="axis-text">
                {value.toFixed(1)}
              </text>
            </g>
          );
        })}

        {Array.from({ length: xTicks + 1 }).map((_, i) => {
          const value = minX + ((maxX - minX) / xTicks) * i;
          const x = xScale(value);
          return (
            <g key={`x-${i}`}>
              <line
                x1={x}
                y1={padding.top}
                x2={x}
                y2={height - padding.bottom}
                className="grid-line"
              />
              <text x={x} y={height - padding.bottom + 20} textAnchor="middle" className="axis-text">
                {value.toFixed(0)}
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          y1={height - padding.bottom}
          x2={width - padding.right}
          y2={height - padding.bottom}
          className="axis-line"
        />
        <line
          x1={padding.left}
          y1={padding.top}
          x2={padding.left}
          y2={height - padding.bottom}
          className="axis-line"
        />

        <polyline points={polylinePoints} fill="none" className="curve-line" />

        {records.map((d) => (
          <g key={d.id}>
            <circle
              cx={xScale(Number(d.time))}
              cy={yScale(Number(d.rawTemperature))}
              r="4.2"
              className="curve-point"
            />
          </g>
        ))}

        <text x={width / 2} y={height - 8} textAnchor="middle" className="axis-title">
          时间（h）
        </text>

        <text
          x="16"
          y={height / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${height / 2})`}
          className="axis-title"
        >
          原始体温值（°C）
        </text>
      </svg>
    </div>
  );
}

export default function App() {
  const [temperature, setTemperature] = useState("");
  const [time, setTime] = useState("");
  const [site, setSite] = useState("");
  const [records, setRecords] = useState([]);
  const [message, setMessage] = useState("");
  const [finalResult, setFinalResult] = useState(null);

  const sortedRecords = useMemo(() => {
    return [...records].sort((a, b) => Number(a.time) - Number(b.time));
  }, [records]);

  function resetStatusOnly() {
    setMessage("");
    setFinalResult(null);
  }

  function handleSubmitOne() {
    resetStatusOnly();

    if (temperature === "" || time === "" || site === "") {
      setMessage("请输入完整的单次体温记录");
      return;
    }

    const tempNum = Number(temperature);
    const timeNum = Number(time);

    if (Number.isNaN(tempNum) || Number.isNaN(timeNum)) {
      setMessage("请输入有效数字");
      return;
    }

    if (tempNum < 32 || tempNum > 44) {
      setMessage("体温测量值应在 32–44 °C 之间");
      return;
    }

    if (timeNum < 0 || timeNum > 72) {
      setMessage("测量时间应在 0–72 h 之间");
      return;
    }

    const normalizedTemperature = normalizeTemperature(tempNum, site);
    const standardizedTemperature = standardizeTemperature(normalizedTemperature);

    const newRecord = {
      id: crypto.randomUUID(),
      rawTemperature: tempNum,
      time: timeNum,
      site,
      normalizedTemperature,
      standardizedTemperature,
    };

    setRecords((prev) => [...prev, newRecord]);
    setTemperature("");
    setTime("");
    setSite("");
    setMessage("单次体温记录提交成功");
  }

  function handleRemove(id) {
    resetStatusOnly();
    setRecords((prev) => prev.filter((item) => item.id !== id));
  }

  function handleClearAll() {
    setRecords([]);
    setTemperature("");
    setTime("");
    setSite("");
    setMessage("");
    setFinalResult(null);
  }

  function handleConfirmFinished() {
    resetStatusOnly();

    if (records.length === 0) {
      setMessage("暂无已提交体温数据");
      return;
    }

    const sorted = [...records].sort((a, b) => Number(a.time) - Number(b.time));
    const firstTime = Number(sorted[0].time);
    const lastTime = Number(sorted[sorted.length - 1].time);
    const span = lastTime - firstTime;

    if (span < 24) {
      setMessage("时间跨度不足 24 h，暂不能完成分型");
      return;
    }

    if (firstTime > 24) {
      setMessage("最早体温测量时间应位于脓毒症诊断后 24 h 内");
      return;
    }

    const { missNum, missRate } = computeMissRate(sorted);
    if (missRate > 0.3) {
      setMessage("体温缺失率过高，暂不能完成分型");
      return;
    }

    const classification = classifyTrajectory(sorted);

    setFinalResult({
      sorted,
      firstTime,
      lastTime,
      span,
      missNum,
      missRate,
      best: classification.best,
      weightedMortality28: classification.weightedMortality28,
      weightedRssValues: classification.weightedRssValues,
    });

    setMessage("整体体温数据提交成功，已完成轨迹分型");
  }

  return (
    <div className="page-shell">
      <div className="container">
        <header className="hero">
          <div className="hero-badge">临床研究辅助工具</div>
          <h1>ICU 脓毒症患者体温轨迹分型与预后预测网页程序</h1>
          <p className="hero-desc">
            基于患者 0–72 h 体温测量数据，对体温轨迹亚表型进行自动判别，
            并同步输出预后提示信息，便于临床科研与应用展示。
          </p>
        </header>

        <div className="grid">
          <section className="panel panel-input">
            <div className="panel-head">
              <h2>数据输入区</h2>
              <span className="panel-tag">单次录入</span>
            </div>

            <div className="note-box">
              <div className="note-title">数据要求说明</div>
              <ul className="note-list">
                <li>体温测量值范围：32–44 °C。</li>
                <li>测量时间范围：脓毒症诊断后 0–72 h。</li>
                <li>最早体温测量时间应位于 24 h 内。</li>
                <li>整体时间跨度需 ≥24 h。</li>
                <li>系统将自动按时间先后排序并计算缺失率。</li>
              </ul>
            </div>

            <label>体温测量值（°C）</label>
            <input
              type="number"
              step="0.01"
              min="32"
              max="44"
              value={temperature}
              onChange={(e) => setTemperature(e.target.value)}
              placeholder="请输入 32–44 之间的数值"
            />

            <label>距离脓毒症诊断的时间（h）</label>
            <input
              type="number"
              step="0.01"
              min="0"
              max="72"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              placeholder="请输入 0–72 之间的数值"
            />

            <label>体温测量部位</label>
            <div className="site-grid">
              {SITE_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={site === option ? "site-btn active" : "site-btn"}
                  onClick={() => setSite(option)}
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="btn-row">
              <button type="button" className="primary-btn" onClick={handleSubmitOne}>
                提交单次体温记录
              </button>
              <button type="button" className="secondary-btn" onClick={handleConfirmFinished}>
                提交整体体温数据
              </button>
              <button type="button" className="ghost-btn" onClick={handleClearAll}>
                清空全部
              </button>
            </div>

            {message && <div className="message">{message}</div>}
          </section>

          <section className="panel panel-display">
            <div className="panel-head">
              <h2>已录入体温数据</h2>
              <span className="panel-tag">{sortedRecords.length} 条</span>
            </div>

            {sortedRecords.length === 0 ? (
              <div className="empty-card">暂无已录入数据</div>
            ) : (
              <div className="record-list">
                {sortedRecords.map((item, index) => (
                  <div key={item.id} className="record-card">
                    <div className="record-top">
                      <div className="record-index">记录 {index + 1}</div>
                      <button type="button" className="delete-btn" onClick={() => handleRemove(item.id)}>
                        删除
                      </button>
                    </div>

                    <div className="record-grid">
                      <div><span>时间：</span>{format2(item.time)} h</div>
                      <div><span>原始体温：</span>{format2(item.rawTemperature)} °C</div>
                      <div><span>测量部位：</span>{item.site}</div>
                      <div><span>口腔等效体温：</span>{format8(item.normalizedTemperature)}</div>
                      <div><span>标准化体温：</span>{format8(item.standardizedTemperature)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel panel-result">
            <div className="panel-head">
              <h2>轨迹分型结果</h2>
              <span className="panel-tag">最终输出</span>
            </div>

            {!finalResult ? (
              <div className="empty-card">
                完成整体体温数据提交后，将在此处显示体温轨迹亚表型、预计 28 天病死率及迷你曲线图。
              </div>
            ) : (
              <div className="result-card">
                <div className="result-highlight">
                  <div className="result-label">体温轨迹亚表型</div>
                  <div className="result-group">{finalResult.best.name}</div>
                </div>

                <div className="result-stats">
                  <div className="stat-item">
                    <span>最早时间点</span>
                    <strong>{format2(finalResult.firstTime)} h</strong>
                  </div>
                  <div className="stat-item">
                    <span>最晚时间点</span>
                    <strong>{format2(finalResult.lastTime)} h</strong>
                  </div>
                  <div className="stat-item">
                    <span>时间跨度</span>
                    <strong>{format2(finalResult.span)} h</strong>
                  </div>
                  <div className="stat-item">
                    <span>缺失个数</span>
                    <strong>{finalResult.missNum}</strong>
                  </div>
                  <div className="stat-item">
                    <span>缺失率</span>
                    <strong>{finalResult.missRate.toFixed(4)}</strong>
                  </div>
                  <div className="stat-item emphasis">
                    <span>预计 28 天病死率</span>
                    <strong>{formatPercent(finalResult.weightedMortality28, 1)}</strong>
                  </div>
                </div>

                <div className="chart-card">
                  <div className="chart-title">原始体温迷你曲线图</div>
                  <MiniCurveChart records={finalResult.sorted} />
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
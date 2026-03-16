import { useMemo, useState } from "react";
import "./App.css";

const ORAL_MEAN = 36.99849987;

const SITE_OFFSETS = {
  Temporal: ORAL_MEAN - 36.68074579,
  Tympanic: ORAL_MEAN - 36.68493572,
  Axillary: ORAL_MEAN - 36.74558987,
  Blood: ORAL_MEAN - 36.91808807,
  Esophogeal: ORAL_MEAN - 36.96569889,
  Oral: 0,
  Rectal: ORAL_MEAN - 37.13131609,
};

const SITE_OPTIONS = [
  "Temporal",
  "Tympanic",
  "Axillary",
  "Blood",
  "Esophogeal",
  "Oral",
  "Rectal",
];

// 整体标准化参数
const OVERALL_MEAN = 37.09379897;
const OVERALL_STD = 0.69606188;

const TRAJECTORIES = [
  {
    code: 1,
    name: "Hypothermia",
    a: -0.000078,
    b: 0.010543,
    c: -1.522477,
    mortality28: "28.6%",
  },
  {
    code: 2,
    name: "Low-grade fever",
    a: -0.000322,
    b: 0.029391,
    c: -0.163585,
    mortality28: "17.9%",
  },
  {
    code: 3,
    name: "Normothermia",
    a: -0.000034,
    b: 0.002003,
    c: -0.415289,
    mortality28: "17.5%",
  },
  {
    code: 4,
    name: "Rapidly resolving high fever",
    a: 0.000363,
    b: -0.045280,
    c: 1.258603,
    mortality28: "13.4%",
  },
  {
    code: 5,
    name: "Sustained high fever",
    a: -0.000172,
    b: 0.010583,
    c: 1.140373,
    mortality28: "20.7%",
  },
];

function format8(value) {
  return Number(value).toFixed(8);
}

function calculateRss(a, b, c, timeList, measurementList) {
  if (timeList.length !== measurementList.length) {
    throw new Error("时间列表和测量值列表的长度必须相同");
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

// 第一步：统一为口腔体温
function normalizeTemperature(temperature, site) {
  const offset = SITE_OFFSETS[site] ?? 0;
  return Number((Number(temperature) + offset).toFixed(8));
}

// 第二步：整体标准化
function standardizeTemperature(temperature) {
  return Number(((Number(temperature) - OVERALL_MEAN) / OVERALL_STD).toFixed(8));
}

function classifyTrajectory(records) {
  const timeList = records.map((item) => Number(item.time));
  // 注意：这里改为使用标准化后的体温值
  const measurementList = records.map((item) => Number(item.standardizedTemperature));

  const rssValues = TRAJECTORIES.map((traj) => ({
    code: traj.code,
    name: traj.name,
    mortality28: traj.mortality28,
    rss: calculateRss(traj.a, traj.b, traj.c, timeList, measurementList),
  }));

  const best = rssValues.reduce((min, cur) => (cur.rss < min.rss ? cur : min), rssValues[0]);
  return { best, rssValues };
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
      setMessage("数据不全");
      return;
    }

    const tempNum = Number(temperature);
    const timeNum = Number(time);

    if (Number.isNaN(tempNum) || Number.isNaN(timeNum)) {
      setMessage("请输入有效数字");
      return;
    }

    if (tempNum < 32 || tempNum > 44 || timeNum < 0 || timeNum > 72) {
      setMessage("数据范围异常");
      return;
    }

    // 先统一到口腔体温
    const normalizedTemperature = normalizeTemperature(tempNum, site);
    // 再做整体标准化
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
    setMessage("当前数据已提交");
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
      setMessage("暂无已提交数据");
      return;
    }

    const sorted = [...records].sort((a, b) => Number(a.time) - Number(b.time));
    const firstTime = Number(sorted[0].time);
    const lastTime = Number(sorted[sorted.length - 1].time);
    const span = lastTime - firstTime;

    if (span < 24) {
      setMessage("时间跨度小于24");
      return;
    }

    if (firstTime > 24) {
      setMessage("未在脓毒症诊断24小时内测量");
      return;
    }

    const { missNum, missRate } = computeMissRate(sorted);
    if (missRate > 0.3) {
      setMessage("体温缺失率过高");
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
      rssValues: classification.rssValues,
    });

    setMessage("分类计算完成");
  }

  return (
    <div className="container">
      <h1>Sepsis Temperature Trajectory Classifier</h1>

      <div className="grid">
        <div className="panel">
          <h2>输入区</h2>

          <label>体温测量值</label>
          <input
            type="number"
            step="0.01"
            min="32"
            max="44"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
            placeholder="32–44"
          />

          <label>距离脓毒症诊断的时间（小时）</label>
          <input
            type="number"
            step="0.01"
            min="0"
            max="72"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="0–72"
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
            <button type="button" onClick={handleSubmitOne}>提交</button>
            <button type="button" onClick={handleConfirmFinished}>确认输入完毕</button>
            <button type="button" onClick={handleClearAll}>清空全部</button>
          </div>

          {message && <div className="message">{message}</div>}
        </div>

        <div className="panel">
          <h2>显示框</h2>
          <p>当前已提交 {sortedRecords.length} 组数据</p>

          {sortedRecords.length === 0 ? (
            <div className="empty">暂无已提交数据。</div>
          ) : (
            sortedRecords.map((item, index) => (
              <div key={item.id} className="record">
                <div>序号：{index + 1}</div>
                <div>时间：{item.time} h</div>
                <div>原始体温：{item.rawTemperature}</div>
                <div>部位：{item.site}</div>
                <div>统一为口腔体温：{format8(item.normalizedTemperature)}</div>
                <div>标准化体温：{format8(item.standardizedTemperature)}</div>
                <button type="button" onClick={() => handleRemove(item.id)}>删除</button>
              </div>
            ))
          )}

          {finalResult && (
            <div className="result">
              <h3>分类结果</h3>
              <p>最早时间点：{finalResult.firstTime} h</p>
              <p>最晚时间点：{finalResult.lastTime} h</p>
              <p>时间跨度：{finalResult.span} h</p>
              <p>缺失个数：{finalResult.missNum}</p>
              <p>缺失率：{finalResult.missRate.toFixed(4)}</p>
              <p>
                最终归类：Group {finalResult.best.code} - {finalResult.best.name}
              </p>
              <p>预计 28 天病死率：{finalResult.best.mortality28}</p>
              <p>最小 RSS：{finalResult.best.rss.toFixed(8)}</p>

              <h4>五个亚组 RSS</h4>
              <ul>
                {finalResult.rssValues.map((item) => (
                  <li key={item.code}>
                    Group {item.code} - {item.name}: RSS = {item.rss.toFixed(8)}, 28-day mortality = {item.mortality28}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

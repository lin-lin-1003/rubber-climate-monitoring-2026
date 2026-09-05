"use strict";

const state = {data: null, sort: "region", metrics: new Set(), regionType: "all", selected: new Set(), onlySelected: false, annual: new Map()};
const byId = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const finite = value => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
const latitude = station => finite(station.latitude) ? Number(station.latitude) : -Infinity;
const fmt = (value, digits = 1) => finite(value) ? Number(value).toFixed(digits) : "—";

function stationSort(a, b) {
  return latitude(b) - latitude(a)
    || String(a.country).localeCompare(String(b.country), "zh-CN")
    || String(a.region).localeCompare(String(b.region), "zh-CN")
    || Number(a.catalog_order) - Number(b.catalog_order)
    || String(a.station_name).localeCompare(String(b.station_name), "zh-CN");
}

function median(values) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return -Infinity;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function regionGroups() {
  const grouped = new Map();
  for (const station of state.data.stations || []) {
    const key = `${station.country}\u0000${station.region}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(station);
  }
  return [...grouped.entries()].map(([key, members]) => ({
    key,
    label: `${members[0].country} · ${members[0].region}`,
    anchor: median(members.map(item => item.latitude)),
    stations: members.sort(stationSort),
  })).sort((a, b) => b.anchor - a.anchor || a.label.localeCompare(b.label, "zh-CN"));
}

function orderedStations() {
  if (state.sort === "station") return [...(state.data.stations || [])].sort(stationSort);
  return regionGroups().flatMap(group => group.stations);
}

function rainClass(value) {
  if (!finite(value) || Number(value) <= 0) return "rain-none";
  if (value < 0.1) return "rain-1";
  if (value < 2.5) return "rain-2";
  if (value < 6.25) return "rain-3";
  if (value < 12.5) return "rain-4";
  if (value < 25) return "rain-5";
  return "rain-6";
}

function timeLabel(timestamp) {
  const value = String(timestamp || "");
  return value.length >= 16 ? `${value.slice(5, 10)} ${value.slice(11, 13)}时` : value;
}

function rainfallTable(stations) {
  const rainfall = state.data.rainfall_6h || {timestamps: [], values: {}};
  if (!rainfall.timestamps.length) return '<div class="empty">当前没有可展示的七天降雨数据。</div>';
  const header = rainfall.timestamps.map(value => `<th>${esc(timeLabel(value))}</th>`).join("");
  const rows = stations.map(station => {
    const values = rainfall.values[station.station_id] || rainfall.timestamps.map(() => null);
    const present = values.filter(finite);
    const total = present.length ? present.reduce((sum, value) => sum + Number(value), 0) : null;
    const cells = values.map(value => `<td class="${rainClass(value)}">${fmt(value, 1)}</td>`).join("");
    return `<tr data-station-id="${esc(station.station_id)}"><td class="region-cell">${esc(station.country)} · ${esc(station.region)}</td><td class="place">${esc(station.station_name)}<small>${fmt(station.latitude, 2)}°N</small></td>${cells}<td><strong>${fmt(total, 1)}</strong></td></tr>`;
  }).join("");
  return `<div class="data-panel table-wrap rainfall-all"><table class="rain-table"><thead><tr><th class="region-cell">国家 · 地区</th><th class="place">地点</th>${header}<th>7天合计</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function renderRainfall() {
  const stations = orderedStations();
  byId("rainfall").innerHTML = stations.length ? rainfallTable(stations) : '<div class="empty">没有已配置的地点。</div>';
}

function imageKey(country, region, station) {
  return `${country || ""}\u0000${region || ""}\u0000${station || ""}`;
}

function imageMaps() {
  const byStationId = new Map();
  const byIdentity = new Map();
  for (const item of state.data.location_images || []) {
    if (item.station_id) byStationId.set(String(item.station_id), item);
    byIdentity.set(imageKey(item.country, item.region, item.station), item);
  }
  return {byStationId, byIdentity};
}

function locationImageCard(station, maps) {
  const item = maps.byStationId.get(String(station.station_id))
    || maps.byIdentity.get(imageKey(station.country, station.region, station.station_name));
  if (!item || !item.asset) return "";
  const imageUrl = `wecom/${encodeURIComponent(String(item.asset))}`;
  const title = item.title || `${station.station_name}年度天气图`;
  return `<article class="station-card image-card" data-station-id="${esc(station.station_id)}">
    <a class="annual-image-link" href="${imageUrl}" target="_blank" rel="noopener" title="打开原尺寸图片">
      <img class="annual-image" src="${imageUrl}" alt="${esc(title)}" loading="lazy">
    </a>
    <div class="image-body"><div><h3>${esc(station.station_name)}</h3><p>${esc(station.country)} · ${esc(station.region)} · ${fmt(station.latitude, 2)}°N</p></div><a class="image-action" href="${imageUrl}" download>下载原图</a></div>
  </article>`;
}

const percentages = value => finite(value) ? (value * 100).toFixed(2) + "%" : "—";
function productionLabel(station) {
  if (!station.production_tonnes && !finite(station.production_tonnes)) return "2025产量 — 吨 · 本国占比 " + percentages(station.domestic_share) + " · 全球占比 —";
  return "2025产量 " + Number(station.production_tonnes).toLocaleString("zh-CN") + " 吨 · 本国占比 " + percentages(station.domestic_share) + " · 全球占比 " + percentages(station.global_share);
}
function allRegions() { return state.data.monitoring?.regions || []; }
function regionFor(station) { return allRegions().find(r => r.region_key === station.region_key); }
function typeMatches(region) {
  if (state.regionType === "all") return true;
  if (state.regionType === "missing") return region.has_missing;
  if (state.regionType === "anomaly") return region.has_anomaly;
  return region.directions.includes(state.regionType);
}
function filteredStations() {
  return orderedStations().filter(s => {
    const r = regionFor(s);
    return r && typeMatches(r) && (!state.onlySelected || state.selected.has(s.region_key));
  });
}
function renderControls() {
  const metrics = state.data.metric_definitions || [];
  const c = state.data.monitoring?.counts || {};
  byId("annual-controls").innerHTML = '<div class="metric-checks" role="group" aria-label="显示指标">' +
    metrics.map(m => '<label><input type="checkbox" data-metric="' + esc(m.key) + '"' + (state.metrics.has(m.key) ? ' checked' : '') + '>' + esc(m.label) + '</label>').join("") +
    '</div><div class="anomaly-controls"><strong>异常地区 ' + (c.anomaly || 0) + ' 个</strong><label>筛选 <select id="regionType"><option value="all">全部地区</option><option value="anomaly">全部异常</option><option value="high">高位</option><option value="low">低位</option><option value="missing">数据不足</option></select></label>' +
    '<details class="region-picker"><summary>选择异常地区 <span id="selected-count"></span></summary><div class="region-options">' +
    allRegions().filter(r => r.has_anomaly || r.has_missing).map(r => '<label><input type="checkbox" data-region="' + esc(r.region_key) + '"' + (state.selected.has(r.region_key) ? ' checked' : '') + '><span>' + esc(r.country + " · " + r.production_region + '（' + r.station_names.join('、') + '）') + '<small>' + esc(r.status) + ' · 影响分 ' + fmt(r.impact_score, 2) + (r.has_missing ? ' · 含数据不足项' : '') + '</small></span></label>').join("") +
    '</div></details><label><input id="onlySelected" type="checkbox"' + (state.onlySelected ? ' checked' : '') + '>仅看已选</label><button type="button" id="resetAnnual">恢复全部</button><span id="visibleCount"></span></div>' +
    '<p class="annual-legend"><span class="legend-band">历史 P10–P90</span><span class="legend-median">历史 P50</span><span class="legend-actual">本年实况</span><span class="legend-forecast">未来预测</span><small>全年日期 · 累计缺日断线 · 点击/悬停同步查看数值</small></p>';
  byId("regionType").value = state.regionType;
  document.querySelectorAll("[data-metric]").forEach(box => box.addEventListener("change", () => {
    box.checked ? state.metrics.add(box.dataset.metric) : state.metrics.delete(box.dataset.metric);
    renderLocations();
  }));
  document.querySelectorAll("[data-region]").forEach(box => box.addEventListener("change", () => {
    box.checked ? state.selected.add(box.dataset.region) : state.selected.delete(box.dataset.region);
    updateSelection();
    if (state.onlySelected) renderLocations();
    else document.querySelectorAll(".annual-station").forEach(el => el.classList.toggle("chosen", state.selected.has(el.dataset.regionKey)));
    if (box.checked) {
      const target = filteredStations().find(s => s.region_key === box.dataset.region);
      const row = target && byId("station-" + target.station_id);
      if (row) { row.open = true; row.scrollIntoView({behavior:"smooth", block:"center"}); focusAnomaly(row, target); }
    }
  }));
  byId("regionType").addEventListener("change", event => { state.regionType = event.target.value; renderLocations(); });
  byId("onlySelected").addEventListener("change", event => { state.onlySelected = event.target.checked; renderLocations(); });
  byId("resetAnnual").addEventListener("click", () => {
    state.metrics = new Set(metrics.map(m => m.key)); state.regionType = "all";
    state.selected.clear(); state.onlySelected = false; renderControls(); renderLocations();
  });
  updateSelection();
}
function updateSelection() { if (byId("selected-count")) byId("selected-count").textContent = state.selected.size ? "(" + state.selected.size + ")" : ""; }
function focusAnomaly(row, station) {
  const key = regionFor(station)?.primary?.metric;
  if (key && !state.metrics.has(key)) {
    state.metrics.add(key);
    const box = document.querySelector('[data-metric="' + key + '"][type=checkbox]');
    if (box) box.checked = true;
    renderLocations();
    row = byId('station-' + station.station_id);
  }
  const card = [...row.querySelectorAll(".annual-metric")].find(el => el.dataset.metric === key);
  if (card) { row.querySelector(".chart-strip").scrollTo({left:card.offsetLeft - row.querySelector(".chart-strip").offsetLeft, behavior:"smooth"}); }
}
let chartObserver;
function renderLocations() {
  if (chartObserver) chartObserver.disconnect();
  const stations = filteredStations();
  const metrics = (state.data.metric_definitions || []).filter(m => state.metrics.has(m.key));
  byId("locations").innerHTML = stations.length ? '<div class="location-grid">' + stations.map(s => {
    const r = regionFor(s);
    const label = r?.has_anomaly ? r.status + " · 影响分 " + fmt(r.impact_score, 2) : r?.has_missing ? "含数据不足项" : "正常";
    return '<details open id="station-' + esc(s.station_id) + '" class="annual-station station-card' + (state.selected.has(s.region_key) ? ' chosen' : '') + '" data-station-id="' + esc(s.station_id) + '" data-region-key="' + esc(s.region_key) + '">' +
      '<summary><span><strong>' + esc(s.country + " · " + s.station_name) + '</strong> <span class="province">' + esc(s.production_region) + '</span><small>' + esc(productionLabel(s)) + '</small></span><span class="anomaly-badge ' + esc(r?.primary?.direction || "") + '">' + esc(label) + '</span></summary>' +
      '<div class="strip-actions"><span>' + metrics.length + ' 个指标 · 左右滑动 · 实况截至 ' + esc(s.actual_as_of || '待补') + '</span><button type="button" class="slide-prev" aria-label="' + esc(s.station_name) + '上一组指标">←</button><button type="button" class="slide-next" aria-label="' + esc(s.station_name) + '下一组指标">→</button></div>' +
      '<div class="chart-strip" tabindex="0" aria-label="' + esc(s.station_name) + '年度指标图">' +
      (metrics.length ? metrics.map(m => '<figure class="annual-metric" data-station="' + esc(s.station_id) + '" data-metric="' + esc(m.key) + '"><figcaption>' + esc(m.label) + '<span>' + esc(m.unit) + '</span></figcaption><div class="plot-area"><p class="chart-placeholder">正在读取年度数据…</p></div><div class="chart-readout">点击或悬停查看同期数值</div></figure>').join("") : '<p class="chart-empty">请至少勾选一个指标。</p>') +
      '</div>' + (r?.has_anomaly ? '<p class="trigger-note">' + esc(signalText(r.primary)) + '</p>' : '') + '</details>';
  }).join("") + '</div>' : '<div class="empty">当前选择没有地点。可点击“恢复全部”。</div>';
  if (byId("visibleCount")) byId("visibleCount").textContent = stations.length + "/" + (state.data.stations || []).length + " 个地点";
  document.querySelectorAll(".annual-station").forEach(row => {
    row.querySelector(".slide-prev").onclick = () => row.querySelector(".chart-strip").scrollBy({left:-760, behavior:"smooth"});
    row.querySelector(".slide-next").onclick = () => row.querySelector(".chart-strip").scrollBy({left:760, behavior:"smooth"});
  });
  chartObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) drawCard(entry.target); });
  }, {rootMargin:"250px 100px"});
  document.querySelectorAll(".annual-metric").forEach(el => chartObserver.observe(el));
}
function signalText(s) {
  return (s.period === "actual" ? "实况" : "预测") + " " + s.start + "—" + s.end + " · " + s.label + " " + fmt(s.value, s.unit === "m³/m³" ? 3 : 1) + s.unit + " · " + s.status + " · 历史P" + fmt(s.percentile) + " · P10–P90 " + fmt(s.p10, 2) + "–" + fmt(s.p90, 2) + " · 有效" + s.days + "/" + s.expected_days + "天，" + s.years + "个基准年";
}
function pathSegments(values, x, y) {
  let result = "", pen = false;
  values.forEach((value, index) => {
    if (!finite(value)) { pen = false; return; }
    result += (pen ? "L" : "M") + x(index).toFixed(2) + "," + y(value).toFixed(2);
    pen = true;
  });
  return result;
}
function bandPaths(low, high, x, y) {
  let paths = "", start = -1;
  for (let i = 0; i <= low.length; i++) {
    if (i < low.length && finite(low[i]) && finite(high[i])) { if (start < 0) start = i; }
    else if (start >= 0) {
      const top = [], bottom = [];
      for (let j = start; j < i; j++) { top.push(x(j) + "," + y(high[j])); bottom.unshift(x(j) + "," + y(low[j])); }
      paths += '<path d="M' + top.join("L") + "L" + bottom.join("L") + 'Z" fill="#d9eaf4"/>';
      start = -1;
    }
  }
  return paths;
}
function drawCard(card) {
  if (!card.isConnected || card.dataset.drawn === "1") return;
  const payload = state.annual.get(card.dataset.station);
  if (!payload) return;
  if (payload.error) { card.querySelector(".plot-area").innerHTML = '<p class="chart-empty">年度数据读取失败，请刷新重试。</p>'; return; }
  const series = payload.metrics[card.dataset.metric];
  if (!series) return;
  card.dataset.drawn = "1";
  const observed = [...series.p10, ...series.p90, ...series.actual, ...series.forecast].filter(finite);
  if (!observed.length) { card.querySelector(".plot-area").innerHTML = '<p class="chart-empty">没有可用数据</p>'; return; }
  let low = Math.min(...observed), high = Math.max(...observed);
  const pad = Math.max((high-low)*.09, card.dataset.metric.startsWith("soil") ? .01 : .5);
  low = card.dataset.metric.includes("precipitation") ? 0 : low - pad;
  high += pad;
  const x = i => 54 + i / (payload.dates.length-1) * 590;
  const y = value => 214 - (value-low) / (high-low) * 178;
  let body = bandPaths(series.p10, series.p90, x, y);
  for (let i = 0; i <= 4; i++) {
    const v = low + (high-low)*i/4, yy = y(v);
    body += '<line x1="54" x2="644" y1="' + yy + '" y2="' + yy + '" class="chart-grid"/><text x="47" y="' + (yy+4) + '" text-anchor="end" class="chart-label">' + v.toFixed(card.dataset.metric.startsWith("soil") ? 2 : 0) + '</text>';
  }
  payload.dates.forEach((d, i) => { if (d.endsWith("-01")) body += '<text x="' + x(i) + '" y="237" class="chart-label">' + Number(d.slice(5,7)) + '月</text>'; });
  body += '<path d="' + pathSegments(series.p50,x,y) + '" fill="none" stroke="#7895a4" stroke-width="1.2"/>' +
    '<path d="' + pathSegments(series.actual,x,y) + '" fill="none" stroke="#246bc0" stroke-width="2"/>' +
    '<path d="' + pathSegments(series.forecast,x,y) + '" fill="none" stroke="#cd5145" stroke-width="2" stroke-dasharray="5 3"/>' +
    '<line class="sync-cursor" x1="54" x2="54" y1="30" y2="215" stroke="#536c69" stroke-dasharray="3 3" opacity="0"/>';
  card.querySelector(".plot-area").innerHTML = '<svg role="img" aria-label="' + esc(card.querySelector("figcaption").textContent) + '年度图" viewBox="0 0 660 250">' + body + '</svg>';
  const svg = card.querySelector("svg");
  const move = event => {
    const rect = svg.getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width * 660;
    const index = Math.max(0, Math.min(payload.dates.length-1, Math.round((position - 54)/590*(payload.dates.length-1))));
    syncDate(index);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("click", move);
}
function syncDate(index) {
  document.querySelectorAll('.annual-metric[data-drawn="1"]').forEach(card => {
    const data = state.annual.get(card.dataset.station), values = data?.metrics[card.dataset.metric];
    if (!values) return;
    const cursor = card.querySelector(".sync-cursor");
    if (cursor) {
      const position = 54 + index/(data.dates.length-1)*590;
      cursor.setAttribute("x1", position); cursor.setAttribute("x2", position); cursor.setAttribute("opacity","1");
    }
    const digits = card.dataset.metric.startsWith("soil") ? 3 : 1;
    card.querySelector(".chart-readout").textContent = data.dates[index].slice(5) + " 实况 " + fmt(values.actual[index],digits) + " · 预测 " + fmt(values.forecast[index],digits) +
      " · 历史P50 " + fmt(values.p50[index],digits) + " · P10–P90 " + fmt(values.p10[index],digits) + "–" + fmt(values.p90[index],digits) + " (" + values.years[index] + "年)";
  });
}
async function loadAnnual() {
  const queue = [...(state.data.stations || [])];
  await Promise.all(Array.from({length:4}, async () => {
    while (queue.length) {
      const station = queue.shift();
      if (!station.annual_url) continue;
      try {
        const response = await fetch(station.annual_url + "?v=" + encodeURIComponent(state.data.generated_at));
        if (!response.ok) throw new Error("HTTP " + response.status);
        state.annual.set(station.station_id, await response.json());
      } catch (error) { state.annual.set(station.station_id, {error:error.message}); }
      document.querySelectorAll(".annual-metric").forEach(card => {
        if (card.dataset.station !== station.station_id) return;
        const rect = card.getBoundingClientRect();
        if (rect.top < innerHeight + 250 && rect.bottom > -250 && rect.left < innerWidth + 100 && rect.right > -100) drawCard(card);
      });
    }
  }));
}

function renderAll() {
  renderRainfall();
  renderLocations();
}

function setSort(mode) {
  if (mode !== "region" && mode !== "station") return;
  state.sort = mode;
  document.querySelectorAll(".sort-button").forEach(button => {
    const active = button.dataset.sort === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  byId("sort-description").textContent = mode === "region"
    ? "当前排序：按地区纬度。两部分均按地区纬度从北到南排列。"
    : "当前排序：按地点纬度。两部分的 67 个地点均按实际纬度全局排列。";
  if (state.data) {
    renderAll();
    for (const id of ["rainfall", "locations"]) {
      const element = byId(id);
      element.classList.remove("sort-flash");
      void element.offsetWidth;
      element.classList.add("sort-flash");
    }
  }
}

window.setPageSort = setSort;

async function init() {
  try {
    const embedded = byId("dashboard-data");
    if (embedded && embedded.textContent.trim()) {
      state.data = JSON.parse(embedded.textContent);
    } else {
      const response = await fetch("data/dashboard.json", {cache: "no-store"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
    }
    state.metrics = new Set((state.data.metric_definitions || []).map(m => m.key));
    renderControls();
    setSort(state.sort);
    const weekly = state.data.monitoring?.weekly;
    if (weekly) byId("weather-weekly").innerHTML = '<details class="method-note"><summary>每周文字总结 · ' + esc(weekly.start + " 至 " + weekly.end) + '</summary><pre>' + esc(weekly.compact_text) + '</pre></details>';
    loadAnnual();
  } catch (error) {
    const message = `<div class="error">网页数据读取失败：${esc(error.message)}。</div>`;
    byId("rainfall").innerHTML = message;
    byId("locations").innerHTML = message;
  }
}

document.addEventListener("DOMContentLoaded", init);

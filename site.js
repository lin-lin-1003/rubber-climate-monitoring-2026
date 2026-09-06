"use strict";

const state = {data: null, sort: "region", metrics: new Set(), regionType: "all", selected: new Set(), onlySelected: false, annual: new Map(), comparisonYears: new Set(), scrollLeft: 0, closed: new Set(), dateIndex: null, dragging: false, productionFilter: "all"};
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
  const leaders = new Set(productionLeaders().map(r => r.region_key));
  return orderedStations().filter(s => {
    const r = regionFor(s);
    return r && (state.productionFilter === "all" || leaders.has(s.region_key)) && typeMatches(r) && (!state.onlySelected || state.selected.has(s.region_key));
  });
}
function productionLeaders() {
  return (state.data.high_production || []).filter(r => state.productionFilter === "th" ? r.country === "泰国" : state.productionFilter === "id" ? r.country === "印度尼西亚" : true);
}
function scoreSummary(region) {
  if (!region) return "";
  const render = (score, label) => '<span><strong>' + label + ' ' + fmt(score?.climate_score) + '</strong> · 深层缺水 ' + fmt(score?.modules?.moisture) + ' · 降雨 ' + fmt(score?.modules?.rain) + ' · 温度 ' + fmt(score?.modules?.temperature) + (score?.ready ? '' : ' · 核心数据待补') + '</span>';
  const periods = region.period_scores || {};
  const details = (region.signals || []).filter(s => s.core).map(s => '<tr><td>' + esc((s.period === 'actual' ? '实况' : '预测') + ' · ' + s.label) + '<small>' + esc(s.station_name + ' / ' + (s.data_basis || '') + ' / ' + s.start + '—' + s.end) + '</small></td><td>' + fmt(s.value,s.unit==='m³/m³'?3:1) + ' ' + esc(s.unit) + '</td><td>' + fmt(s.mean,3) + ' / ' + fmt(s.std,3) + '</td><td>' + fmt(s.z,2) + '</td><td>' + fmt(s.climate_score,2) + '</td><td>' + fmt(s.minimum,3) + '—' + fmt(s.maximum,3) + '<small>' + esc(s.status) + '</small></td></tr>').join('');
  return '<div class="score-summary">' + render(periods.actual,'实况综合') + render(periods.forecast,'预测综合') + '<small>深层缺水50%＋降雨30%＋温度20%；缺项不合成，不是减产率。实况深层贡献 ' + fmt(periods.actual?.contributions?.moisture) + ' 分。</small></div><details class="score-details"><summary>查看连续分项、标准差与历史范围</summary><div class="table-wrap"><table><thead><tr><th>指标 / 时段</th><th>当前值</th><th>历史均值 / 标准差</th><th>z</th><th>连续分</th><th>历史范围 / 状态</th></tr></thead><tbody>' + details + '</tbody></table></div></details>';
}
// Year identity is stable across selections, stations and metrics (color + dash).
function yearStyle(year) {
  const colors = ["#887018", "#934b70", "#637238", "#b56422", "#57637b"];
  const index = (state.data.comparison_years || []).indexOf(Number(year));
  return {color: colors[Math.max(0, index) % colors.length], dash: ["7 3", "2 3", "9 3 2 3"][Math.floor(Math.max(0, index) / colors.length) % 3]};
}
function selectedYears() { return (state.data.comparison_years || []).filter(y => state.comparisonYears.has(y)); }
function yearSwatch(year) {
  const style = yearStyle(year);
  return '<svg class="year-swatch" aria-hidden="true" viewBox="0 0 28 8"><path d="M0,4H28" stroke="' + style.color + '" stroke-width="2" stroke-dasharray="' + style.dash + '"/></svg>';
}
function updateYears() {
  const years = selectedYears();
  byId("year-selection-label").textContent = years.length ? years.join("、") : "无（仅实况、预测与历史区间）";
  byId("year-legend").innerHTML = years.map(y => '<span>' + yearSwatch(y) + y + '</span>').join("");
  byId("annual-controls").querySelectorAll("[data-year]").forEach(box => { box.checked = state.comparisonYears.has(Number(box.dataset.year)); });
  // Reserve equal readout height so pointer movement cannot shift following rows.
  document.documentElement.style.setProperty("--readout-height", (62 + Math.ceil(years.length / 4) * 19) + "px");
  document.documentElement.style.setProperty("--mobile-readout-height", (94 + Math.ceil(years.length / 2) * 19) + "px");
  document.querySelectorAll(".annual-metric").forEach(card => {
    delete card.dataset.drawn;
    card.querySelector(".plot-area").innerHTML = '<p class="chart-placeholder">正在绘制年度数据…</p>';
    card.querySelector(".chart-readout").textContent = "点击或悬停查看同期数值";
    chartObserver?.unobserve(card);
    chartObserver?.observe(card);
  });
}
function renderControls() {
  const metrics = state.data.metric_definitions || [];
  const c = state.data.monitoring?.counts || {};
  byId("annual-controls").innerHTML = '<div class="metric-checks" role="group" aria-label="显示指标">' +
    metrics.map(m => '<label><input type="checkbox" data-metric="' + esc(m.key) + '"' + (state.metrics.has(m.key) ? ' checked' : '') + '>' + esc(m.label) + '</label>').join("") +
    '</div><div class="production-controls" role="group" aria-label="高产地区筛选">' + [['all','全部地区'],['both','两国高产地区（18）'],['th','泰国前10府'],['id','印尼前8省']].map(([key,label]) => '<button type="button" data-production="' + key + '" aria-pressed="' + (state.productionFilter === key) + '">' + label + '</button>').join('') + '<a href="wecom/open_meteo_high_production_regions.png" target="_blank" rel="noopener">高产专题图 ↗</a><small>按2025产量排名，府省去重；选高产专题会清除异常条件，仍可进一步筛选。</small></div><div class="year-controls"><details class="year-picker"><summary>对比年份 <span id="year-selection-label"></span></summary><div class="year-options"><div class="year-actions"><button type="button" id="years-all">全选年份</button><button type="button" id="years-clear">清空年份</button></div>' +
    (state.data.comparison_years || []).map(y => '<label><input type="checkbox" data-year="' + y + '">' + yearSwatch(y) + y + '</label>').join("") + '</div></details><small>可多选 · 本年实况、预测和历史区间始终显示</small></div>' +
    '<div class="anomaly-controls"><strong>异常地区 ' + (c.anomaly || 0) + ' 个</strong><label>筛选 <select id="regionType"><option value="all">全部地区</option><option value="anomaly">全部异常</option><option value="high">高位</option><option value="low">低位</option><option value="missing">数据不足</option></select></label>' +
    '<details class="region-picker"><summary>选择异常地区 <span id="selected-count"></span></summary><div class="region-options">' +
    allRegions().filter(r => r.has_anomaly || r.has_missing).map(r => '<label><input type="checkbox" data-region="' + esc(r.region_key) + '"' + (state.selected.has(r.region_key) ? ' checked' : '') + '><span>' + esc(r.country + " · " + r.production_region + '（' + r.station_names.join('、') + '）') + '<small>' + esc(r.status) + ' · 影响分 ' + fmt(r.impact_score, 2) + (r.has_missing ? ' · 含数据不足项' : '') + '</small></span></label>').join("") +
    '</div></details><label><input id="onlySelected" type="checkbox"' + (state.onlySelected ? ' checked' : '') + '>仅看已选</label><button type="button" id="resetAnnual">恢复全部</button><span id="visibleCount"></span></div>' +
    '<div class="annual-legend"><span class="legend-band">历史最低—最高（P0–P100）</span><span class="legend-actual">本年实况</span><span class="legend-forecast">未来预测</span><div id="year-legend"></div></div>' +
    '<p class="annual-baseline-note">历史区间固定 ' + state.data.annual_baseline.start + '—' + state.data.annual_baseline.end + ' 年，不随年份勾选变化；同期不足 ' + state.data.annual_baseline.minimum_years + ' 年不绘制阴影。按月日对齐，本年非闰年不绘制历史 2 月 29 日；本年闰年时，非闰年的 2 月 29 日留空。累计先逐年计算，缺日断线。点击/悬停同步查值。</p>';
  byId("regionType").value = state.regionType;
  byId("annual-controls").querySelectorAll('[data-production]').forEach(button => button.onclick = () => {
    state.productionFilter = button.dataset.production; state.regionType = 'all'; state.onlySelected = false; state.selected.clear();
    const url = new URL(location.href); url.searchParams.set('production',state.productionFilter); history.replaceState(null,'',url);
    renderControls(); renderLocations();
  });
  byId("annual-controls").querySelectorAll("[data-metric]").forEach(box => box.addEventListener("change", () => {
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
    state.metrics = new Set(metrics.map(m => m.key)); state.regionType = "all"; state.productionFilter = "all";
    const url = new URL(location.href); url.searchParams.delete('production'); history.replaceState(null,'',url);
    state.selected.clear(); state.onlySelected = false; renderControls(); renderLocations();
  });
  byId("annual-controls").querySelectorAll("[data-year]").forEach(box => box.addEventListener("change", () => {
    const year = Number(box.dataset.year);
    box.checked ? state.comparisonYears.add(year) : state.comparisonYears.delete(year);
    updateYears();
  }));
  byId("years-all").onclick = () => { state.comparisonYears = new Set(state.data.comparison_years); updateYears(); };
  byId("years-clear").onclick = () => { state.comparisonYears.clear(); updateYears(); };
  updateYears();
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
  if (card) setAnnualPosition(card.offsetLeft - 14);
}
let chartObserver;
let annualStrips = [], annualStride = 622;
const expectedScroll = new WeakMap();
function openStrip() { return annualStrips.find(el => el.closest("details").open && el.clientWidth); }
function setAnnualPosition(left) {
  const lead = openStrip();
  const max = lead ? Math.max(0, lead.scrollWidth - lead.clientWidth) : state.scrollLeft;
  // An empty filter or collapsed rows must not erase the saved shared position.
  state.scrollLeft = Math.max(0, Math.min(left, max));
  annualStrips.forEach(strip => {
    if (!strip.closest("details").open) return;
    expectedScroll.set(strip, state.scrollLeft);
    if (Math.abs(strip.scrollLeft - state.scrollLeft) > .5) strip.scrollLeft = state.scrollLeft;
  });
  const slider = byId("annual-position");
  slider.max = Math.ceil(max); slider.value = state.scrollLeft;
  slider.disabled = !lead || max === 0;
  byId("annual-prev").disabled = !lead || state.scrollLeft < 1;
  byId("annual-next").disabled = !lead || state.scrollLeft >= max - 1;
  const metrics = (state.data.metric_definitions || []).filter(m => state.metrics.has(m.key));
  const label = metrics[Math.min(metrics.length - 1, Math.floor((state.scrollLeft + 1) / annualStride))]?.label || "请勾选指标";
  byId("annual-position-label").textContent = label;
  slider.setAttribute("aria-valuetext", label);
}
function refreshAnnualGeometry() {
  const card = openStrip()?.querySelector(".annual-metric");
  if (card) {
    const stride = card.getBoundingClientRect().width + 12;
    state.scrollLeft = state.scrollLeft / annualStride * stride;
    annualStride = stride;
  }
  document.documentElement.style.setProperty("--sort-toolbar-height", document.querySelector(".toolbar").getBoundingClientRect().height + "px");
  setAnnualPosition(state.scrollLeft);
}
function bindAnnualScroll() {
  annualStrips = [...document.querySelectorAll(".chart-strip")];
  annualStrips.forEach(strip => {
    strip.addEventListener("scroll", () => {
      if (!strip.isConnected || !strip.closest("details").open) return;
      if (Math.abs(strip.scrollLeft - (expectedScroll.get(strip) ?? -1)) > .5) setAnnualPosition(strip.scrollLeft);
    }, {passive: true});
    strip.addEventListener("keydown", event => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      setAnnualPosition(event.key === "Home" ? 0 : event.key === "End" ? strip.scrollWidth : state.scrollLeft + (event.key === "ArrowRight" ? annualStride : -annualStride));
    });
    // Touch/trackpad use native scrolling; desktop mouse drag has the same linkage.
    let drag = null;
    strip.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && event.button === 0) drag = {x: event.clientX, left: state.scrollLeft, id: event.pointerId};
    });
    strip.addEventListener("pointermove", event => {
      if (!drag) return;
      if (!state.dragging && Math.abs(event.clientX - drag.x) < 6) return;
      state.dragging = true; strip.classList.add("dragging");
      strip.setPointerCapture(drag.id);
      setAnnualPosition(drag.left - (event.clientX - drag.x));
    });
    const end = () => {
      if (drag && strip.hasPointerCapture(drag.id)) strip.releasePointerCapture(drag.id);
      drag = null; strip.classList.remove("dragging");
      setTimeout(() => { state.dragging = false; }, 0);
    };
    strip.addEventListener("pointerup", end);
    strip.addEventListener("pointercancel", end);
    strip.addEventListener("lostpointercapture", end);
    const row = strip.closest("details");
    row.addEventListener("toggle", () => {
      if (!row.isConnected) return;
      row.open ? state.closed.delete(row.dataset.stationId) : state.closed.add(row.dataset.stationId);
      setAnnualPosition(state.scrollLeft);
    });
  });
  refreshAnnualGeometry();
}
function renderLocations() {
  if (chartObserver) chartObserver.disconnect();
  const stations = filteredStations();
  const metrics = (state.data.metric_definitions || []).filter(m => state.metrics.has(m.key));
  byId("locations").innerHTML = stations.length ? '<div class="location-grid">' + stations.map(s => {
    const r = regionFor(s);
    const leader = (state.data.high_production || []).find(item => item.region_key === s.region_key);
    const label = (leader ? '高产 #' + leader.production_rank + ' · ' : '') + (r?.status || '实际待补') + ' · 加权 ' + fmt(r?.impact_score,2);
    return '<details' + (state.closed.has(s.station_id) ? '' : ' open') + ' id="station-' + esc(s.station_id) + '" class="annual-station station-card' + (state.selected.has(s.region_key) ? ' chosen' : '') + '" data-station-id="' + esc(s.station_id) + '" data-region-key="' + esc(s.region_key) + '">' +
      '<summary><span><strong>' + esc(s.country + " · " + s.station_name) + '</strong> <span class="province">' + esc(s.production_region) + '</span><small>' + esc(productionLabel(s)) + '</small></span><span class="anomaly-badge ' + esc(r?.primary?.direction || "") + '">' + esc(label) + '</span></summary>' +
      '<div class="strip-actions"><span>' + metrics.length + ' 个指标 · 左右拖动联动所有地区 · 实况截至 ' + esc(s.actual_as_of || '待补') + '</span></div>' +
      scoreSummary(r) + '<div class="chart-strip" tabindex="0" aria-label="' + esc(s.station_name) + '年度指标图">' +
      (metrics.length ? metrics.map(m => '<figure class="annual-metric" data-station="' + esc(s.station_id) + '" data-metric="' + esc(m.key) + '"><figcaption>' + esc(m.label) + '<span>' + esc(m.unit) + '</span></figcaption><div class="plot-area"><p class="chart-placeholder">正在读取年度数据…</p></div><div class="chart-readout">点击或悬停查看同期数值</div></figure>').join("") : '<p class="chart-empty">请至少勾选一个指标。</p>') +
      '</div>' + (r?.has_anomaly ? '<p class="trigger-note">' + esc(signalText(r.primary)) + '</p>' : '') + '</details>';
  }).join("") + '</div>' : '<div class="empty">当前选择没有地点。可点击“恢复全部”。</div>';
  const missingLeaders = state.productionFilter === 'all' ? [] : productionLeaders().filter(r => r.weather_missing);
  if (missingLeaders.length) byId('locations').insertAdjacentHTML('beforeend', missingLeaders.map(r => '<article class="missing-production"><strong>' + esc(r.country + ' · ' + r.production_region) + ' · 高产 #' + r.production_rank + '</strong><p>' + esc(productionLabel(r)) + '</p><p>天气待补，未参与评分；该地区仍保留在高产名单。</p></article>').join(''));
  if (byId("visibleCount")) byId("visibleCount").textContent = new Set(stations.map(s=>s.region_key)).size + ' 个府省 · ' + stations.length + ' 个天气点' + (missingLeaders.length ? ' · 另有 ' + missingLeaders.length + ' 个高产区天气待补' : '');
  bindAnnualScroll();
  chartObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => { if (entry.isIntersecting) drawCard(entry.target); });
  }, {rootMargin:"250px 100px"});
  document.querySelectorAll(".annual-metric").forEach(el => chartObserver.observe(el));
}
function signalText(s) {
  return (s.period === "actual" ? "实况" : "预测") + ' ' + (s.data_basis || '') + " " + s.start + "—" + s.end + " · " + s.label + " " + fmt(s.value, s.unit === "m³/m³" ? 3 : 1) + s.unit + " · " + s.status + " · 连续分 " + fmt(s.climate_score,2) + " · z=" + fmt(s.z,2) + " · 历史范围 " + fmt(s.minimum, 3) + "–" + fmt(s.maximum, 3) + " · 有效" + s.days + "/" + s.expected_days + "天，" + s.years + "个基准年";
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
  // Include every baseline year in the scale so checking years cannot move axes.
  const observed = [...series.minimum, ...series.maximum, ...series.actual, ...series.forecast, ...Object.values(series.history).flat()].filter(finite);
  if (!observed.length) { card.querySelector(".plot-area").innerHTML = '<p class="chart-empty">没有可用数据</p>'; return; }
  let low = Math.min(...observed), high = Math.max(...observed);
  const pad = Math.max((high-low)*.09, card.dataset.metric.startsWith("soil") ? .01 : .5);
  low = card.dataset.metric.includes("precipitation") ? 0 : low - pad;
  high += pad;
  const x = i => 54 + i / (payload.dates.length-1) * 590;
  const y = value => 214 - (value-low) / (high-low) * 178;
  let body = bandPaths(series.minimum, series.maximum, x, y);
  for (let i = 0; i <= 4; i++) {
    const v = low + (high-low)*i/4, yy = y(v);
    body += '<line x1="54" x2="644" y1="' + yy + '" y2="' + yy + '" class="chart-grid"/><text x="47" y="' + (yy+4) + '" text-anchor="end" class="chart-label">' + v.toFixed(card.dataset.metric.startsWith("soil") ? 2 : 0) + '</text>';
  }
  payload.dates.forEach((d, i) => { if (d.endsWith("-01")) body += '<text x="' + x(i) + '" y="237" class="chart-label">' + Number(d.slice(5,7)) + '月</text>'; });
  selectedYears().forEach(year => {
    const style = yearStyle(year);
    body += '<path class="comparison-year" data-year="' + year + '" d="' + pathSegments(series.history[String(year)] || [],x,y) + '" fill="none" stroke="' + style.color + '" stroke-width="1.4" stroke-dasharray="' + style.dash + '"/>';
  });
  body += '<path class="actual-line" d="' + pathSegments(series.actual,x,y) + '" fill="none" stroke="#246bc0" stroke-width="2"/>' +
    '<path d="' + pathSegments(series.forecast,x,y) + '" fill="none" stroke="#cd5145" stroke-width="2" stroke-dasharray="5 3"/>' +
    '<line class="sync-cursor" x1="54" x2="54" y1="30" y2="215" stroke="#536c69" stroke-dasharray="3 3" opacity="0"/>';
  card.querySelector(".plot-area").innerHTML = '<svg role="img" aria-label="' + esc(card.querySelector("figcaption").textContent) + '年度图" viewBox="0 0 660 250">' + body + '</svg>';
  const svg = card.querySelector("svg");
  const move = event => {
    if (state.dragging || event.buttons || (event.type !== "click" && event.pointerType === "touch")) return;
    const rect = svg.getBoundingClientRect();
    const position = (event.clientX - rect.left) / rect.width * 660;
    const index = Math.max(0, Math.min(payload.dates.length-1, Math.round((position - 54)/590*(payload.dates.length-1))));
    syncDate(index);
  };
  svg.addEventListener("pointermove", move);
  svg.addEventListener("click", move);
  if (state.dateIndex !== null) updateReadout(card, state.dateIndex);
}
function syncDate(index) {
  state.dateIndex = index;
  document.querySelectorAll('.annual-metric[data-drawn="1"]').forEach(card => updateReadout(card, index));
}
function updateReadout(card, index) {
    const data = state.annual.get(card.dataset.station), values = data?.metrics[card.dataset.metric];
    if (!values) return;
    const cursor = card.querySelector(".sync-cursor");
    if (cursor) {
      const position = 54 + index/(data.dates.length-1)*590;
      cursor.setAttribute("x1", position); cursor.setAttribute("x2", position); cursor.setAttribute("opacity","1");
    }
    const digits = card.dataset.metric.startsWith("soil") ? 3 : 1;
    const unit = state.data.metric_definitions.find(m => m.key === card.dataset.metric)?.unit || "";
    const actual = finite(values.actual[index]) ? fmt(values.actual[index], digits) : "—（实际待补/未到期）";
    card.querySelector(".chart-readout").innerHTML = '<div><strong>' + data.dates[index].slice(5) + '</strong> · ' + esc(unit) + '　实况 ' + actual + ' · 预测 ' + fmt(values.forecast[index],digits) + '</div><div>历史最低—最高 ' + fmt(values.minimum[index],digits) + '–' + fmt(values.maximum[index],digits) + '（' + values.years[index] + ' 个有效年）</div><div class="year-values">' +
      selectedYears().map(year => '<span>' + yearSwatch(year) + year + ' ' + fmt(values.history[String(year)]?.[index],digits) + '</span>').join("") + '</div>';
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
    for (const year of state.data.default_comparison_years || [2015,2016]) if (state.data.comparison_years.includes(year)) state.comparisonYears.add(year);
    const filter = new URLSearchParams(location.search).get('production');
    if (['all','both','th','id'].includes(filter)) state.productionFilter = filter;
    renderControls();
    byId("annual-prev").onclick = () => setAnnualPosition(state.scrollLeft - annualStride);
    byId("annual-next").onclick = () => setAnnualPosition(state.scrollLeft + annualStride);
    byId("annual-position").oninput = event => setAnnualPosition(Number(event.target.value));
    new ResizeObserver(() => refreshAnnualGeometry()).observe(document.querySelector(".toolbar"));
    window.addEventListener("resize", () => requestAnimationFrame(refreshAnnualGeometry));
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

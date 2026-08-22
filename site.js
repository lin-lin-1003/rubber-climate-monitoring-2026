"use strict";

const state = {data: null, sort: "region"};
const byId = id => document.getElementById(id);
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[char]);
const finite = value => Number.isFinite(Number(value));
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

function renderLocations() {
  const maps = imageMaps();
  const cards = orderedStations().map(station => locationImageCard(station, maps)).filter(Boolean).join("");
  byId("locations").innerHTML = cards
    ? `<div class="location-grid">${cards}</div>`
    : '<div class="empty">暂无年度地点图；请先运行一次完整更新。</div>';
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
    setSort(state.sort);
  } catch (error) {
    const message = `<div class="error">网页数据读取失败：${esc(error.message)}。</div>`;
    byId("rainfall").innerHTML = message;
    byId("locations").innerHTML = message;
  }
}

document.addEventListener("DOMContentLoaded", init);



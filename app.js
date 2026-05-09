const state = {
  datasets: [],
  view: { scale: 1, offsetX: 0, offsetY: 0, mode: "3d", yaw: 35, pitch: 45, topLocked: false },
  colorMode: "off",
  worldBounds: null,
  drag: { active: false, lastX: 0, lastY: 0, action: "pan", moved: false },
  renderCache: { points: [], triangles: [] },
  selection: null
};

const palette = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#f43f5e", "#60a5fa"];

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const fileInput = document.getElementById("fileInput");
const datasetList = document.getElementById("datasetList");
const statusEl = document.getElementById("status");
const inspectEl = document.getElementById("inspect");
const compareA = document.getElementById("compareA");
const compareB = document.getElementById("compareB");
const compareBtn = document.getElementById("compareBtn");
const compareResult = document.getElementById("compareResult");
const threeDControls = document.getElementById("threeDControls");
const yawRange = document.getElementById("yawRange");
const pitchRange = document.getElementById("pitchRange");
const topViewLock = document.getElementById("topViewLock");
const elevColorModeRadios = document.querySelectorAll("input[name='elevColorMode']");

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  render();
}
window.addEventListener("resize", resizeCanvas);

function parseSJW(text) {
  const lines = text.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
  const rawValues = [];
  for (const line of lines) {
    if (line.toLowerCase() === "nil") break;
    const n = Number(line);
    if (!Number.isFinite(n)) throw new Error(`存在非数字行：${line}`);
    rawValues.push(n);
  }
  if (rawValues.length % 9 !== 0) throw new Error(`数据行不是 9 的倍数，当前为 ${rawValues.length}`);

  const triangles = [];
  for (let i = 0; i < rawValues.length; i += 9) {
    triangles.push([
      { x: rawValues[i], y: rawValues[i + 1], z: rawValues[i + 2] },
      { x: rawValues[i + 3], y: rawValues[i + 4], z: rawValues[i + 5] },
      { x: rawValues[i + 6], y: rawValues[i + 7], z: rawValues[i + 8] }
    ]);
  }
  return triangles;
}

function getBounds(triangles) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  triangles.forEach(tri => tri.forEach(p => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
  }));
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

function mergeWorldBounds() {
  if (!state.datasets.length) {
    state.worldBounds = null;
    return;
  }
  const b = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
  state.datasets.forEach(ds => {
    b.minX = Math.min(b.minX, ds.bounds.minX);
    b.minY = Math.min(b.minY, ds.bounds.minY);
    b.minZ = Math.min(b.minZ, ds.bounds.minZ);
    b.maxX = Math.max(b.maxX, ds.bounds.maxX);
    b.maxY = Math.max(b.maxY, ds.bounds.maxY);
    b.maxZ = Math.max(b.maxZ, ds.bounds.maxZ);
  });
  state.worldBounds = b;
}

function projectPoint3D(x, y, z) {
  const radYaw = state.view.yaw * Math.PI / 180;
  const radPitch = state.view.pitch * Math.PI / 180;
  const centerX = (state.worldBounds.minX + state.worldBounds.maxX) / 2;
  const centerY = (state.worldBounds.minY + state.worldBounds.maxY) / 2;
  const centerZ = (state.worldBounds.minZ + state.worldBounds.maxZ) / 2;

  const tx = x - centerX;
  const ty = y - centerY;
  const tz = z - centerZ;

  const x1 = tx * Math.cos(radYaw) - ty * Math.sin(radYaw);
  const y1 = tx * Math.sin(radYaw) + ty * Math.cos(radYaw);
  const y2 = y1 * Math.cos(radPitch) - tz * Math.sin(radPitch);
  return { x: x1, y: y2 };
}

function getProjectedSize() {
  if (!state.worldBounds) return { w: 1, h: 1 };
  if (state.view.mode === "2d") {
    return {
      w: state.worldBounds.maxX - state.worldBounds.minX || 1,
      h: state.worldBounds.maxY - state.worldBounds.minY || 1
    };
  }
  const corners = [
    [state.worldBounds.minX, state.worldBounds.minY, state.worldBounds.minZ],
    [state.worldBounds.minX, state.worldBounds.minY, state.worldBounds.maxZ],
    [state.worldBounds.minX, state.worldBounds.maxY, state.worldBounds.minZ],
    [state.worldBounds.minX, state.worldBounds.maxY, state.worldBounds.maxZ],
    [state.worldBounds.maxX, state.worldBounds.minY, state.worldBounds.minZ],
    [state.worldBounds.maxX, state.worldBounds.minY, state.worldBounds.maxZ],
    [state.worldBounds.maxX, state.worldBounds.maxY, state.worldBounds.minZ],
    [state.worldBounds.maxX, state.worldBounds.maxY, state.worldBounds.maxZ]
  ].map(v => projectPoint3D(v[0], v[1], v[2]));

  const xs = corners.map(v => v.x);
  const ys = corners.map(v => v.y);
  return { w: Math.max(...xs) - Math.min(...xs) || 1, h: Math.max(...ys) - Math.min(...ys) || 1 };
}

function resetView() {
  if (!state.worldBounds) return;
  const { w, h } = getProjectedSize();
  const vw = canvas.clientWidth;
  const vh = canvas.clientHeight;
  state.view.scale = Math.max(0.01, Math.min((vw - 80) / w, (vh - 80) / h));
  state.view.offsetX = vw / 2;
  state.view.offsetY = vh / 2;
  if (state.view.mode === "2d") {
    const cx = (state.worldBounds.minX + state.worldBounds.maxX) / 2;
    const cy = (state.worldBounds.minY + state.worldBounds.maxY) / 2;
    state.view.offsetX = vw / 2 - cx * state.view.scale;
    state.view.offsetY = vh / 2 + cy * state.view.scale;
  }
  render();
}

function pointToScreen(p) {
  if (state.view.mode === "2d") {
    return { x: p.x * state.view.scale + state.view.offsetX, y: -p.y * state.view.scale + state.view.offsetY };
  }
  const prj = projectPoint3D(p.x, p.y, p.z);
  return { x: prj.x * state.view.scale + state.view.offsetX, y: -prj.y * state.view.scale + state.view.offsetY };
}

function zToAlpha(z, minZ, maxZ) {
  if (maxZ === minZ) return 0.45;
  return 0.25 + ((z - minZ) / (maxZ - minZ)) * 0.45;
}

function hexToHsl(hex) {
  const raw = hex.replace("#", "");
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function getElevationColor(z, baseHex) {
  const minZ = state.worldBounds?.minZ ?? 0;
  const maxZ = state.worldBounds?.maxZ ?? 1;
  const span = maxZ - minZ || 1;
  let t = (z - minZ) / span;
  t = Math.max(0, Math.min(1, t));
  if (state.colorMode === "elevation") t = 1 - t;
  const base = hexToHsl(baseHex);
  const hue = base.h;
  const sat = Math.max(40, Math.min(90, base.s));
  const light = 22 + t * 58;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function hexToRgba(hex, alpha) {
  const val = hex.replace("#", "");
  const r = parseInt(val.substring(0, 2), 16);
  const g = parseInt(val.substring(2, 4), 16);
  const b = parseInt(val.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function render() {
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  state.renderCache.points = [];
  state.renderCache.triangles = [];

  if (state.view.mode === "3d") {
    const sky = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
    sky.addColorStop(0, "#d9dde2");
    sky.addColorStop(0.45, "#c7ccd2");
    sky.addColorStop(0.55, "#a7adb4");
    sky.addColorStop(1, "#8d939a");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  } else {
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  }

  if (!state.datasets.length) return;

  state.datasets.forEach(ds => {
    if (!ds.visible) return;
    ds.triangles.forEach((tri, triIndex) => {
      const a = pointToScreen(tri[0]);
      const b = pointToScreen(tri[1]);
      const c = pointToScreen(tri[2]);
      const avgZ = (tri[0].z + tri[1].z + tri[2].z) / 3;
      const alpha = zToAlpha(avgZ, ds.bounds.minZ, ds.bounds.maxZ);

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      if (state.colorMode === "off") ctx.fillStyle = hexToRgba(ds.color, alpha);
      else ctx.fillStyle = getElevationColor(avgZ, ds.color);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(ds.color, Math.min(1, alpha + 0.35));
      ctx.lineWidth = 1;
      ctx.stroke();

      state.renderCache.triangles.push({ datasetId: ds.id, triIndex, world: tri, screen: [a, b, c] });
      state.renderCache.points.push({ datasetId: ds.id, triIndex, pointIndex: 0, world: tri[0], screen: a });
      state.renderCache.points.push({ datasetId: ds.id, triIndex, pointIndex: 1, world: tri[1], screen: b });
      state.renderCache.points.push({ datasetId: ds.id, triIndex, pointIndex: 2, world: tri[2], screen: c });
    });
  });

  drawSelection();
  drawAxisGizmo();
  const modeText = state.view.mode === "2d" ? "俯视" : "三维";
  const colorText = state.colorMode === "off" ? "关闭" : (state.colorMode === "depth" ? "水深" : "高程");
  statusEl.textContent = `模式: ${modeText} | 着色: ${colorText} | 已加载 ${state.datasets.length} 期 | 可见 ${state.datasets.filter(d => d.visible).length} 期`;
}

function drawSelection() {
  if (!state.selection) return;
  if (state.selection.type === "point") {
    const p = pointToScreen(state.selection.world);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.stroke();
    return;
  }
  if (state.selection.type === "triangle") {
    const tri = state.selection.world;
    const a = pointToScreen(tri[0]);
    const b = pointToScreen(tri[1]);
    const c = pointToScreen(tri[2]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawAxisGizmo() {
  const ox = 70;
  const oy = canvas.clientHeight - 60;
  const len = 36;
  ctx.lineWidth = 2;
  ctx.font = "12px Segoe UI";
  ctx.textBaseline = "middle";

  const drawAxis = (label, dir, color) => {
    const ex = ox + dir.x * len;
    const ey = oy + dir.y * len;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(label, ex + dir.x * 8, ey + dir.y * 8);
  };

  if (state.view.mode === "3d") {
    const yaw = state.view.yaw * Math.PI / 180;
    const pitch = state.view.pitch * Math.PI / 180;
    const projectVec = (vx, vy, vz) => {
      const x1 = vx * Math.cos(yaw) - vy * Math.sin(yaw);
      const y1 = vx * Math.sin(yaw) + vy * Math.cos(yaw);
      const y2 = y1 * Math.cos(pitch) - vz * Math.sin(pitch);
      const d = Math.hypot(x1, y2) || 1;
      return { x: x1 / d, y: -y2 / d };
    };
    drawAxis("X", projectVec(1, 0, 0), "#ef4444");
    drawAxis("Y", projectVec(0, 1, 0), "#22c55e");
    drawAxis("Z", projectVec(0, 0, 1), "#3b82f6");
    return;
  }

  drawAxis("X", { x: 1, y: 0 }, "#ef4444");
  drawAxis("Y", { x: 0, y: -1 }, "#22c55e");
  drawAxis("Z", { x: -0.6, y: 0.6 }, "#3b82f6");
}

function refreshSidebar() {
  datasetList.innerHTML = "";
  state.datasets.forEach(ds => {
    const row = document.createElement("div");
    row.className = "dataset-item";

    const top = document.createElement("div");
    top.className = "dataset-top";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = ds.visible;
    check.onchange = () => { ds.visible = check.checked; render(); };

    const color = document.createElement("input");
    color.type = "color";
    color.value = ds.color;
    color.oninput = () => { ds.color = color.value; render(); };

    const name = document.createElement("div");
    name.className = "dataset-name";
    name.textContent = ds.name;

    const removeBtn = document.createElement("button");
    removeBtn.textContent = "删除";
    removeBtn.onclick = () => {
      state.datasets = state.datasets.filter(v => v.id !== ds.id);
      if (state.selection && state.selection.datasetId === ds.id) {
        state.selection = null;
        inspectEl.textContent = "未选择要素";
      }
      mergeWorldBounds();
      refreshSidebar();
      if (state.datasets.length) resetView();
      else {
        render();
        statusEl.textContent = "请先加载 SJW 文件";
      }
    };

    top.append(check, color, name, removeBtn);

    const meta = document.createElement("div");
    meta.className = "dataset-meta";
    meta.textContent = `三角形: ${ds.triangles.length} | Z: ${ds.bounds.minZ.toFixed(3)} ~ ${ds.bounds.maxZ.toFixed(3)}`;
    row.append(top, meta);
    datasetList.appendChild(row);
  });
  refreshCompareSelectors();
}

function refreshCompareSelectors() {
  const options = state.datasets.map((d, i) => `<option value="${i}">${d.name}</option>`).join("");
  compareA.innerHTML = `<option value="">选择一期</option>${options}`;
  compareB.innerHTML = `<option value="">选择一期</option>${options}`;
}

function loadDataset(fileName, text) {
  const triangles = parseSJW(text);
  const bounds = getBounds(triangles);
  state.datasets.push({
    id: crypto.randomUUID(),
    name: fileName,
    triangles,
    bounds,
    visible: true,
    color: palette[state.datasets.length % palette.length]
  });

  mergeWorldBounds();
  refreshSidebar();
  if (state.datasets.length === 1) resetView();
  else render();
}

function compareDatasets(aIndex, bIndex) {
  const a = state.datasets[aIndex];
  const b = state.datasets[bIndex];
  if (!a || !b) return "请选择有效数据";

  const mapA = new Map();
  a.triangles.forEach(tri => tri.forEach(p => mapA.set(`${p.x.toFixed(3)}|${p.y.toFixed(3)}`, p.z)));

  const diffs = [];
  b.triangles.forEach(tri => tri.forEach(p => {
    const key = `${p.x.toFixed(3)}|${p.y.toFixed(3)}`;
    if (mapA.has(key)) diffs.push(p.z - mapA.get(key));
  }));

  if (!diffs.length) return "两期没有同名坐标点（按 X,Y 精确到 0.001 匹配）";

  const sum = diffs.reduce((s, v) => s + v, 0);
  const avg = sum / diffs.length;
  const min = Math.min(...diffs);
  const max = Math.max(...diffs);
  const rms = Math.sqrt(diffs.reduce((s, v) => s + v * v, 0) / diffs.length);

  return [
    `对比：${a.name} → ${b.name}`,
    `重合点数：${diffs.length}`,
    `高程差最小：${min.toFixed(4)}`,
    `高程差最大：${max.toFixed(4)}`,
    `平均差：${avg.toFixed(4)}`,
    `RMS：${rms.toFixed(4)}`
  ].join("\n");
}

function triangleArea2D(tri) {
  const [a, b, c] = tri;
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

function pointInTriangle(px, py, a, b, c) {
  const v0x = c.x - a.x, v0y = c.y - a.y;
  const v1x = b.x - a.x, v1y = b.y - a.y;
  const v2x = px - a.x, v2y = py - a.y;
  const dot00 = v0x * v0x + v0y * v0y;
  const dot01 = v0x * v1x + v0y * v1y;
  const dot02 = v0x * v2x + v0y * v2y;
  const dot11 = v1x * v1x + v1y * v1y;
  const dot12 = v1x * v2x + v1y * v2y;
  const inv = 1 / (dot00 * dot11 - dot01 * dot01 || 1e-12);
  const u = (dot11 * dot02 - dot01 * dot12) * inv;
  const v = (dot00 * dot12 - dot01 * dot02) * inv;
  return u >= 0 && v >= 0 && u + v <= 1;
}

function pickFeature(mx, my) {
  const threshold = 8;
  let bestPoint = null;
  let bestDist = Infinity;

  for (const p of state.renderCache.points) {
    const dx = p.screen.x - mx;
    const dy = p.screen.y - my;
    const d = Math.hypot(dx, dy);
    if (d <= threshold && d < bestDist) {
      bestDist = d;
      bestPoint = p;
    }
  }

  if (bestPoint) {
    const ds = state.datasets.find(v => v.id === bestPoint.datasetId);
    return {
      type: "point",
      datasetId: bestPoint.datasetId,
      world: bestPoint.world,
      text: `点坐标\n数据: ${ds ? ds.name : ""}\nX: ${bestPoint.world.x.toFixed(3)}\nY: ${bestPoint.world.y.toFixed(3)}\nZ: ${bestPoint.world.z.toFixed(3)}`
    };
  }

  for (let i = state.renderCache.triangles.length - 1; i >= 0; i -= 1) {
    const t = state.renderCache.triangles[i];
    const [a, b, c] = t.screen;
    if (pointInTriangle(mx, my, a, b, c)) {
      const ds = state.datasets.find(v => v.id === t.datasetId);
      return {
        type: "triangle",
        datasetId: t.datasetId,
        world: t.world,
        text: `三角形信息\n数据: ${ds ? ds.name : ""}\n面积(XY): ${triangleArea2D(t.world).toFixed(3)}`
      };
    }
  }

  return null;
}

fileInput.addEventListener("change", async e => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    try {
      loadDataset(file.name, await file.text());
    } catch (err) {
      alert(`文件 ${file.name} 解析失败：${err.message}`);
    }
  }
  fileInput.value = "";
});

compareBtn.addEventListener("click", () => {
  const a = compareA.value;
  const b = compareB.value;
  if (a === "" || b === "") {
    compareResult.textContent = "请选择两期数据进行对比";
    return;
  }
  if (a === b) {
    compareResult.textContent = "请选择不同期次";
    return;
  }
  compareResult.textContent = compareDatasets(Number(a), Number(b));
});

canvas.addEventListener("click", e => {
  if (state.drag.moved) return;
  const hit = pickFeature(e.offsetX, e.offsetY);
  if (!hit) {
    state.selection = null;
    inspectEl.textContent = "未选择要素";
    render();
    return;
  }
  state.selection = hit;
  inspectEl.textContent = hit.text;
  render();
});

canvas.addEventListener("dblclick", resetView);
canvas.addEventListener("wheel", e => {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  const oldScale = state.view.scale;
  const newScale = Math.max(0.001, Math.min(1e6, oldScale * factor));

  const mx = e.offsetX;
  const my = e.offsetY;
  const wx = (mx - state.view.offsetX) / oldScale;
  const wy = (my - state.view.offsetY) / -oldScale;

  state.view.scale = newScale;
  state.view.offsetX = mx - wx * newScale;
  state.view.offsetY = my + wy * newScale;
  render();
}, { passive: false });

canvas.addEventListener("mousedown", e => {
  if (e.button !== 0 && e.button !== 1) return;
  if (e.button === 1) e.preventDefault();
  state.drag.active = true;
  state.drag.lastX = e.clientX;
  state.drag.lastY = e.clientY;
  if (e.button === 1) state.drag.action = "pan";
  else state.drag.action = state.view.mode === "3d" ? "rotate" : "pan";
  state.drag.moved = false;
});

window.addEventListener("mousemove", e => {
  if (!state.drag.active) return;
  const dx = e.clientX - state.drag.lastX;
  const dy = e.clientY - state.drag.lastY;
  if (Math.abs(dx) + Math.abs(dy) > 2) state.drag.moved = true;

  if (state.drag.action === "rotate") {
    state.view.yaw += dx * 0.4;
    state.view.pitch -= dy * 0.3;
    state.view.pitch = Math.max(-89, Math.min(89, state.view.pitch));
    if (state.view.yaw > 180) state.view.yaw -= 360;
    if (state.view.yaw < -180) state.view.yaw += 360;
    yawRange.value = state.view.yaw.toFixed(1);
    pitchRange.value = state.view.pitch.toFixed(1);
    render();
  } else {
    state.view.offsetX += dx;
    state.view.offsetY += dy;
    render();
  }

  state.drag.lastX = e.clientX;
  state.drag.lastY = e.clientY;
});

window.addEventListener("mouseup", () => {
  state.drag.active = false;
  setTimeout(() => { state.drag.moved = false; }, 0);
});

canvas.addEventListener("contextmenu", e => e.preventDefault());

topViewLock.addEventListener("change", () => {
  state.view.topLocked = topViewLock.checked;
  state.view.mode = state.view.topLocked ? "2d" : "3d";
  threeDControls.style.display = state.view.mode === "3d" ? "grid" : "none";
  if (state.datasets.length) resetView();
});

yawRange.addEventListener("input", () => {
  state.view.yaw = Number(yawRange.value);
  if (state.view.mode === "3d" && state.datasets.length) render();
});
pitchRange.addEventListener("input", () => {
  state.view.pitch = Number(pitchRange.value);
  if (state.view.mode === "3d" && state.datasets.length) render();
});

elevColorModeRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    if (!radio.checked) return;
    state.colorMode = radio.value;
    render();
  });
});

threeDControls.style.display = "grid";
resizeCanvas();

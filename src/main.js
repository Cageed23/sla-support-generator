import './style.css';
import * as THREE from 'three';
import { Viewer } from './viewer/viewer.js';
import { ACCEPT, importModel, extensionOf, FORMATS } from './io/importers.js';
import { writeStl, write3mf } from './io/exporters.js';
import { createModel, cloneModel, modelVolume, dropToPlate, centerOnPlate, arrangeModels } from './core/model.js';
import { geometryFromPositions, worldPositions, worldBox } from './core/geometry.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 1) => n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const deg = THREE.MathUtils.radToDeg;
const rad = THREE.MathUtils.degToRad;

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('sla-sg:' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem('sla-sg:' + key, JSON.stringify(value));
    } catch {
      // storage unavailable (private mode, sandbox) – settings just are not remembered
    }
  },
};

// ---------------------------------------------------------------- viewer
const viewer = new Viewer($('viewport'), {
  onSelect: () => {
    renderModelList();
    renderSelection();
  },
  onTransform: () => renderSelection(),
  onTransformEnd: (mesh) => {
    // Only translation keeps the height; rotating or scaling re-seats the model.
    if (viewer.transform.mode !== 'translate') dropToPlate(mesh);
    afterChange(mesh);
  },
});

const volume = store.get('volume', { x: 218, y: 123, z: 220 });
viewer.setBuildVolume(volume);
for (const axis of ['x', 'y', 'z']) {
  const input = $('vol-' + axis);
  input.value = volume[axis];
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (!(v >= 10)) {
      input.value = viewer.volume[axis];
      return;
    }
    const next = { ...viewer.volume, [axis]: v };
    viewer.setBuildVolume(next);
    store.set('volume', next);
    renderModelList();
    renderSelection();
    viewer.setView('iso');
  });
}

new MutationObserver(() => viewer.applyTheme()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => viewer.applyTheme());

// ---------------------------------------------------------------- loading
const fileInput = $('file-input');
fileInput.accept = ACCEPT;
$('btn-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  loadFiles([...fileInput.files]);
  fileInput.value = '';
});

async function loadFiles(files) {
  const added = [];
  for (const file of files) {
    const ext = extensionOf(file.name);
    const isCad = FORMATS[ext]?.cad;
    busy(isCad ? `Rechne ${file.name} um (CAD-Kern wird geladen)…` : `Lade ${file.name}…`);
    try {
      const buffer = await file.arrayBuffer();
      const { geometry, format, notes } = await importModel(file.name, buffer);
      const mesh = addModel(file.name.replace(/\.[^.]+$/, ''), geometry, { format, notes });
      added.push(mesh);
      for (const n of notes) toast(n);
      checkScale(mesh);
    } catch (err) {
      console.error(err);
      toast(`${file.name}: ${err.message || err}`, { error: true });
    }
  }
  busy(null);
  if (added.length) {
    viewer.select(added[added.length - 1]);
    viewer.frameSelection();
  }
}

function addModel(name, geometry, meta) {
  const mesh = createModel(name, geometry, meta);
  placeNextToOthers(mesh);
  viewer.addModel(mesh);
  afterChange(mesh);
  return mesh;
}

/** New models go to the right of what is already on the plate. */
function placeNextToOthers(mesh) {
  dropToPlate(mesh);
  if (!viewer.models.length) return;
  const occupied = new THREE.Box3();
  for (const m of viewer.models) occupied.union(worldBox(m));
  const box = worldBox(mesh);
  mesh.position.x += occupied.max.x + 5 - box.min.x;
  mesh.position.y += occupied.getCenter(new THREE.Vector3()).y - box.getCenter(new THREE.Vector3()).y;
  mesh.updateMatrixWorld(true);
}

/** Offers a unit fix when a model is implausibly small or large for a resin printer. */
function checkScale(mesh) {
  const size = worldBox(mesh).getSize(new THREE.Vector3());
  const max = Math.max(size.x, size.y, size.z);
  if (max < 3) {
    toast(`„${mesh.name}“ ist nur ${fmt(max, 2)} mm groß. War die Datei in Metern oder Zentimetern?`, {
      actions: [
        { label: 'cm → mm', run: () => scaleBy(mesh, 10) },
        { label: 'm → mm', run: () => scaleBy(mesh, 1000) },
      ],
    });
  } else if (max > 2 * Math.max(viewer.volume.x, viewer.volume.y, viewer.volume.z)) {
    toast(`„${mesh.name}“ ist ${fmt(max, 0)} mm groß und passt nicht auf die Platte.`, {
      actions: [
        { label: 'Auf Platte einpassen', run: () => fitToPlate(mesh) },
        { label: '÷ 10', run: () => scaleBy(mesh, 0.1) },
      ],
    });
  }
}

// drag & drop
const overlay = $('drop-overlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  overlay.hidden = false;
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.hidden = true;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) loadFiles(files);
});

// sample model: a torus knot has plenty of overhangs to try supports on later
$('btn-sample').addEventListener('click', () => loadSample());
function loadSample() {
  const knot = new THREE.TorusKnotGeometry(16, 5, 220, 36, 2, 3).toNonIndexed();
  const geometry = geometryFromPositions(new Float32Array(knot.getAttribute('position').array));
  const mesh = addModel('Beispiel Torusknoten', geometry, { format: 'Beispiel' });
  viewer.select(mesh);
  return mesh;
}

// ---------------------------------------------------------------- export
$('btn-export-stl').addEventListener('click', () => {
  if (!viewer.models.length) return;
  const data = writeStl(viewer.models.map(worldPositions));
  download(exportName('stl'), data, 'model/stl');
});
$('btn-export-3mf').addEventListener('click', () => {
  if (!viewer.models.length) return;
  const data = write3mf(viewer.models.map((m) => ({ name: m.name, positions: worldPositions(m) })));
  download(exportName('3mf'), data, 'model/3mf');
});

function exportName(ext) {
  const base = viewer.models.length === 1 ? viewer.models[0].name : 'druckplatte';
  return `${base.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.${ext}`;
}

function download(name, bytes, mime) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  const embedded = window.self !== window.top;
  toast(
    embedded
      ? `${name} erstellt. Falls kein Download startet: Diese eingebettete Vorschau blockiert Downloads. Öffne die App direkt (GitHub Pages oder lokal).`
      : `${name} gespeichert.`,
  );
}

// ---------------------------------------------------------------- model list
function renderModelList() {
  const list = $('model-list');
  list.replaceChildren();
  for (const m of viewer.models) {
    const li = document.createElement('li');
    li.className = 'model-item' + (m === viewer.selected ? ' is-selected' : '') + (m.userData.outside ? ' is-outside' : '');
    li.tabIndex = 0;
    li.title = m.userData.outside ? 'Ragt über das Bauvolumen hinaus' : m.name;
    const dot = document.createElement('span');
    dot.className = 'model-dot';
    const name = document.createElement('span');
    name.className = 'model-name';
    name.textContent = m.name;
    const meta = document.createElement('span');
    meta.className = 'model-meta';
    meta.textContent = `${fmt(modelVolume(m) / 1000, 1)} ml`;
    li.append(dot, name, meta);
    li.addEventListener('click', () => viewer.select(m));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        viewer.select(m);
      }
    });
    list.append(li);
  }
  const n = viewer.models.length;
  $('model-count').textContent = n;
  $('model-empty').hidden = n > 0;
  $('btn-arrange').disabled = n === 0;
  $('btn-export-stl').disabled = n === 0;
  $('btn-export-3mf').disabled = n === 0;
  updateStatus();
}

$('btn-arrange').addEventListener('click', () => {
  const fits = arrangeModels(viewer.models, viewer.volume);
  for (const m of viewer.models) viewer.updateBounds(m);
  renderModelList();
  renderSelection();
  viewer.requestRender();
  if (!fits) toast('Nicht alle Modelle passen nebeneinander auf die Platte.', { error: true });
});

// ---------------------------------------------------------------- selection panel
const inputs = {
  pos: ['x', 'y', 'z'].map((a) => $('pos-' + a)),
  rot: ['x', 'y', 'z'].map((a) => $('rot-' + a)),
  scl: ['x', 'y', 'z'].map((a) => $('scl-' + a)),
};

function renderSelection() {
  const m = viewer.selected;
  $('selection').hidden = !m;
  if (!m) return;
  $('sel-name').textContent = m.name;
  const active = document.activeElement;
  const set = (input, v, digits = 2) => {
    if (input !== active) input.value = String(Math.round(v * 10 ** digits) / 10 ** digits || 0);
  };
  ['x', 'y', 'z'].forEach((a, i) => {
    set(inputs.pos[i], m.position[a]);
    set(inputs.rot[i], normDeg(deg(m.rotation[a])));
    // Imported models can need very small factors, so keep 4 significant digits.
    const pct = m.scale[a] * 100;
    set(inputs.scl[i], pct, Math.max(2, 3 - Math.floor(Math.log10(Math.abs(pct) || 1))));
  });
  const size = worldBox(m).getSize(new THREE.Vector3());
  $('st-size').textContent = `${fmt(size.x)} × ${fmt(size.y)} × ${fmt(size.z)} mm`;
  $('st-volume').textContent = `${fmt(modelVolume(m) / 1000, 2)} ml`;
  $('st-tris').textContent = m.userData.triangles.toLocaleString('de-DE');
  $('st-format').textContent = m.userData.format || '–';
  $('st-outside').hidden = !m.userData.outside;
}

function normDeg(d) {
  let v = Math.round(d * 100) / 100;
  if (v <= -180) v += 360;
  if (v > 180) v -= 360;
  return Object.is(v, -0) ? 0 : v;
}

function readNumber(input) {
  const v = parseFloat(String(input.value).replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

inputs.pos.forEach((input, i) => {
  input.addEventListener('change', () => {
    const m = viewer.selected;
    const v = readNumber(input);
    if (!m || v === null || i === 2) return renderSelection();
    m.position.setComponent(i, v);
    afterChange(m);
  });
});

inputs.rot.forEach((input, i) => {
  input.addEventListener('change', () => {
    const m = viewer.selected;
    const v = readNumber(input);
    if (!m || v === null) return renderSelection();
    const r = m.rotation;
    r.set(i === 0 ? rad(v) : r.x, i === 1 ? rad(v) : r.y, i === 2 ? rad(v) : r.z);
    dropToPlate(m);
    afterChange(m);
  });
});

inputs.scl.forEach((input, i) => {
  input.addEventListener('change', () => {
    const m = viewer.selected;
    const v = readNumber(input);
    if (!m || v === null || v <= 0) return renderSelection();
    const s = v / 100;
    if ($('scale-lock').checked) {
      const f = s / m.scale.getComponent(i);
      m.scale.multiplyScalar(f);
    } else {
      m.scale.setComponent(i, s);
    }
    dropToPlate(m);
    afterChange(m);
  });
});

$('btn-fit').addEventListener('click', () => viewer.selected && fitToPlate(viewer.selected));
document.querySelectorAll('[data-unit]').forEach((b) =>
  b.addEventListener('click', () => viewer.selected && scaleBy(viewer.selected, parseFloat(b.dataset.unit))),
);

/** Scales the model uniformly so it fills at most 90 % of the build volume. */
function fitToPlate(mesh) {
  const size = worldBox(mesh).getSize(new THREE.Vector3());
  const { x, y, z } = viewer.volume;
  const factor = 0.9 * Math.min(x / size.x, y / size.y, z / size.z);
  mesh.scale.multiplyScalar(factor);
  centerOnPlate(mesh);
  dropToPlate(mesh);
  afterChange(mesh);
  if (mesh === viewer.selected) viewer.frameSelection();
}

function scaleBy(mesh, factor) {
  mesh.scale.multiplyScalar(factor);
  dropToPlate(mesh);
  afterChange(mesh);
  if (mesh === viewer.selected) viewer.frameSelection();
}

$('btn-drop').addEventListener('click', () => withSelected((m) => dropToPlate(m)));
$('btn-center').addEventListener('click', () => withSelected((m) => centerOnPlate(m)));
$('btn-reset').addEventListener('click', () =>
  withSelected((m) => {
    m.rotation.set(0, 0, 0);
    m.scale.set(1, 1, 1);
    dropToPlate(m);
  }),
);
$('btn-dup').addEventListener('click', duplicateSelected);
$('btn-delete').addEventListener('click', deleteSelected);

function withSelected(fn) {
  const m = viewer.selected;
  if (!m) return;
  fn(m);
  afterChange(m);
}

function duplicateSelected() {
  const m = viewer.selected;
  if (!m) return;
  const copy = cloneModel(m);
  placeNextToOthers(copy);
  viewer.addModel(copy);
  viewer.select(copy);
  afterChange(copy);
}

function deleteSelected() {
  const m = viewer.selected;
  if (!m) return;
  viewer.removeModel(m);
  renderModelList();
  renderSelection();
}

function afterChange(mesh) {
  mesh.updateMatrixWorld(true);
  viewer.updateBounds(mesh);
  viewer.requestRender();
  renderModelList();
  renderSelection();
}

// ---------------------------------------------------------------- tools & views
const modeButtons = document.querySelectorAll('[data-mode]');
function setMode(mode) {
  viewer.setTransformMode(mode);
  modeButtons.forEach((b) => b.classList.toggle('is-active', b.dataset.mode === mode));
}
modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
setMode('translate');

document.querySelectorAll('[data-view]').forEach((b) =>
  b.addEventListener('click', () => (b.dataset.view === 'fit' ? viewer.frameSelection() : viewer.setView(b.dataset.view))),
);

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && key === 'o') {
    e.preventDefault();
    fileInput.click();
  } else if ((e.ctrlKey || e.metaKey) && key === 'd') {
    e.preventDefault();
    duplicateSelected();
  } else if (e.ctrlKey || e.metaKey || e.altKey) {
    return;
  } else if (key === 't') setMode('translate');
  else if (key === 'r') setMode('rotate');
  else if (key === 's') setMode('scale');
  else if (key === 'f') viewer.frameSelection();
  else if (key === 'delete' || key === 'backspace') deleteSelected();
  else if (key === 'escape') viewer.select(null);
});

// ---------------------------------------------------------------- feedback
function updateStatus() {
  const n = viewer.models.length;
  const ml = viewer.models.reduce((s, m) => s + modelVolume(m), 0) / 1000;
  const { x, y, z } = viewer.volume;
  $('statusbar').textContent =
    `Platte ${fmt(x, 0)} × ${fmt(y, 0)} × ${fmt(z, 0)} mm · ${n} ${n === 1 ? 'Modell' : 'Modelle'} · ${fmt(ml, 1)} ml Harz (ohne Supports)`;
}

function busy(text) {
  $('busy').hidden = !text;
  if (text) $('busy-text').textContent = text;
}

function toast(message, { error = false, actions = [], timeout = error ? 9000 : 6000 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' is-error' : '');
  el.setAttribute('role', error ? 'alert' : 'status');
  const body = document.createElement('div');
  body.className = 'toast-body';
  body.textContent = message;
  if (actions.length) {
    const row = document.createElement('div');
    row.className = 'toast-action actions';
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-small';
      b.textContent = a.label;
      b.addEventListener('click', () => {
        a.run();
        el.remove();
      });
      row.append(b);
    }
    body.append(row);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast-close';
  close.setAttribute('aria-label', 'Schließen');
  close.textContent = '×';
  close.addEventListener('click', () => el.remove());
  el.append(body, close);
  $('toasts').append(el);
  setTimeout(() => el.remove(), actions.length ? timeout * 2 : timeout);
}

// Start with an example on the plate so the view is not empty.
renderModelList();
renderSelection();
loadSample();
viewer.select(null);

// Exposed for automated browser tests.
window.__app = { viewer, loadFiles };

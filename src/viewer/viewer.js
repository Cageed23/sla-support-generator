import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

/**
 * 3D view of the build volume. The scene uses the printer's coordinate
 * system: Z points up, the build plate lies at z = 0, units are millimetres.
 */
export class Viewer {
  constructor(container, { onSelect, onTransform, onTransformEnd } = {}) {
    this.container = container;
    this.onSelect = onSelect ?? (() => {});
    this.onTransform = onTransform ?? (() => {});
    this.onTransformEnd = onTransformEnd ?? (() => {});
    this.models = [];
    this.selected = null;
    this.volume = { x: 218, y: 123, z: 220 };

    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 10000);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('change', () => this.requestRender());

    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setSize(0.85);
    this.transform.addEventListener('dragging-changed', (e) => {
      this.controls.enabled = !e.value;
      if (!e.value && this.selected) this.onTransformEnd(this.selected);
    });
    this.transform.addEventListener('objectChange', () => {
      if (this.selected) this.onTransform(this.selected);
    });
    this.transform.addEventListener('change', () => this.requestRender());
    this.scene.add(this.transform.getHelper());

    this.#setupLights();
    this.plate = new THREE.Group();
    this.scene.add(this.plate);
    this.applyTheme();
    this.setBuildVolume(this.volume);

    this.raycaster = new THREE.Raycaster();
    this.#setupPicking();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView('iso');
    this.#loop();
  }

  /** Reads colours from the page's CSS tokens so the scene follows the theme. */
  applyTheme() {
    const css = getComputedStyle(document.documentElement);
    const c = (name, fallback) => new THREE.Color(css.getPropertyValue(name).trim() || fallback);
    this.colors = {
      bg: c('--viewport', '#20232a'),
      plate: c('--plate', '#8a9099'),
      grid: c('--grid', '#5b616b'),
      frame: c('--frame', '#6d7380'),
      model: c('--resin', '#9fa8b3'),
      selected: c('--accent', '#7b5cff'),
      outside: c('--danger', '#e5484d'),
    };
    this.scene.background = this.colors.bg;
    this.#buildPlate();
    for (const m of this.models) this.#paint(m);
    this.requestRender();
  }

  setBuildVolume({ x, y, z }) {
    this.volume = { x, y, z };
    this.#buildPlate();
    for (const m of this.models) this.updateBounds(m);
    this.requestRender();
  }

  addModel(mesh) {
    mesh.material = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, color: this.colors.model });
    this.models.push(mesh);
    this.scene.add(mesh);
    this.updateBounds(mesh);
    this.requestRender();
  }

  removeModel(mesh) {
    if (this.selected === mesh) this.select(null);
    this.models = this.models.filter((m) => m !== mesh);
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
    this.requestRender();
  }

  select(mesh) {
    if (this.selected === mesh) return;
    const prev = this.selected;
    this.selected = mesh;
    if (mesh) this.transform.attach(mesh);
    else this.transform.detach();
    if (prev) this.#paint(prev);
    if (mesh) this.#paint(mesh);
    this.onSelect(mesh);
    this.requestRender();
  }

  setTransformMode(mode) {
    this.transform.setMode(mode);
    // Moving happens on the plate; height is controlled by "lay flat".
    this.transform.showZ = mode !== 'translate';
    this.requestRender();
  }

  /** Marks a model red when any part of it lies outside the build volume. */
  updateBounds(mesh) {
    const box = new THREE.Box3().setFromObject(mesh, true);
    const { x, y, z } = this.volume;
    const eps = 1e-3;
    mesh.userData.outside =
      box.min.x < -x / 2 - eps || box.max.x > x / 2 + eps ||
      box.min.y < -y / 2 - eps || box.max.y > y / 2 + eps ||
      box.min.z < -eps || box.max.z > z + eps;
    this.#paint(mesh);
    return box;
  }

  /** Fits the camera to the plate or, if present, the models. */
  setView(name) {
    const target = new THREE.Vector3(0, 0, this.volume.z * 0.25);
    const size = Math.max(this.volume.x, this.volume.y, this.volume.z * 0.8);
    const dist = size * 1.6;
    const dirs = {
      iso: new THREE.Vector3(0.75, -1.1, 0.8),
      front: new THREE.Vector3(0, -1, 0.05),
      side: new THREE.Vector3(1, 0, 0.05),
      top: new THREE.Vector3(0, -0.001, 1),
      bottom: new THREE.Vector3(0, -0.001, -1),
    };
    const dir = (dirs[name] ?? dirs.iso).clone().normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.update();
    this.requestRender();
  }

  frameSelection() {
    const targets = this.selected ? [this.selected] : this.models;
    if (!targets.length) return this.setView('iso');
    const box = new THREE.Box3();
    for (const m of targets) box.union(new THREE.Box3().setFromObject(m, true));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    this.controls.target.copy(sphere.center);
    this.camera.position.copy(sphere.center).addScaledVector(dir, dist);
    this.controls.update();
    this.requestRender();
  }

  /** Returns the first model hit at the given client coordinates. */
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.models, false)[0];
    return hit ? hit.object : null;
  }

  screenshot() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }

  requestRender() {
    this.dirty = true;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  #loop() {
    requestAnimationFrame(() => this.#loop());
    if (this.controls.update() || this.dirty) this.render();
  }

  #paint(mesh) {
    if (!mesh.material) return;
    const col = mesh.userData.outside ? this.colors.outside : this.colors.model;
    mesh.material.color.copy(col);
    mesh.material.emissive.copy(this.selected === mesh ? this.colors.selected : new THREE.Color(0, 0, 0));
    mesh.material.emissiveIntensity = this.selected === mesh ? 0.18 : 0;
  }

  #setupLights() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404650, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(-0.6, -1, 1.4);
    // The key light follows the camera so the model is always lit from the viewer's side.
    this.camera.add(key);
    key.target.position.set(0, 0, -1);
    this.camera.add(key.target);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(1, 1, -0.5);
    this.camera.add(rim);
    this.scene.add(this.camera);
  }

  #buildPlate() {
    if (!this.plate || !this.colors) return;
    for (const child of [...this.plate.children]) {
      this.plate.remove(child);
      child.geometry?.dispose();
      child.material?.dispose();
    }
    const { x, y, z } = this.volume;

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(x, y, 1.5),
      new THREE.MeshStandardMaterial({ color: this.colors.plate, roughness: 0.75, metalness: 0.3, transparent: true, opacity: 0.85 }),
    );
    plate.position.z = -0.76;
    this.plate.add(plate);

    // 10 mm grid with every 50 mm emphasised.
    const lines = [];
    const major = [];
    for (let gx = 0; gx <= x / 2; gx += 10) {
      for (const s of gx === 0 ? [1] : [1, -1]) {
        (gx % 50 === 0 ? major : lines).push(s * gx, -y / 2, 0.02, s * gx, y / 2, 0.02);
      }
    }
    for (let gy = 0; gy <= y / 2; gy += 10) {
      for (const s of gy === 0 ? [1] : [1, -1]) {
        (gy % 50 === 0 ? major : lines).push(-x / 2, s * gy, 0.02, x / 2, s * gy, 0.02);
      }
    }
    this.plate.add(lineSegments(lines, this.colors.grid, 0.45));
    this.plate.add(lineSegments(major, this.colors.grid, 0.9));

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(x, y, z)),
      new THREE.LineBasicMaterial({ color: this.colors.frame, transparent: true, opacity: 0.55 }),
    );
    frame.position.z = z / 2;
    this.plate.add(frame);

    // Small axis marker in the front-left corner (X red, Y green).
    const ax = lineSegments([0, 0, 0.05, 15, 0, 0.05], new THREE.Color('#e5484d'), 1);
    const ay = lineSegments([0, 0, 0.05, 0, 15, 0.05], new THREE.Color('#30a46c'), 1);
    for (const a of [ax, ay]) {
      a.position.set(-x / 2 + 5, -y / 2 + 5, 0);
      this.plate.add(a);
    }
    this.requestRender();
  }

  #setupPicking() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointerup', (e) => {
      if (!down || this.transform.dragging) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 4) return;
      // A click on the gizmo itself is not a selection change.
      if (this.transform.axis) return;
      this.select(this.pick(e.clientX, e.clientY));
    });
  }
}

function lineSegments(coords, color, opacity) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
}

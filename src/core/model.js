import * as THREE from 'three';
import { centerGeometry, meshVolume, worldBox } from './geometry.js';

let nextId = 1;

/**
 * A printable model on the plate. The geometry is centred on its own origin so
 * rotation and scaling happen around the model's middle.
 */
export function createModel(name, geometry, { format = '', notes = [] } = {}) {
  centerGeometry(geometry);
  const mesh = new THREE.Mesh(geometry);
  mesh.name = name;
  mesh.userData = {
    id: nextId++,
    format,
    notes,
    triangles: geometry.getAttribute('position').count / 3,
    baseVolume: meshVolume(geometry),
  };
  return mesh;
}

export function cloneModel(mesh) {
  const copy = createModel(mesh.name.replace(/( \(\d+\))?$/, '') + ` (${nextId})`, mesh.geometry.clone(), {
    format: mesh.userData.format,
  });
  copy.position.copy(mesh.position);
  copy.quaternion.copy(mesh.quaternion);
  copy.scale.copy(mesh.scale);
  return copy;
}

/** Volume in mm³ including the current scale. */
export function modelVolume(mesh) {
  return mesh.userData.baseVolume * Math.abs(mesh.scale.x * mesh.scale.y * mesh.scale.z);
}

/** Puts the lowest point of the model onto the build plate (z = 0). */
export function dropToPlate(mesh, lift = 0) {
  const box = worldBox(mesh);
  mesh.position.z += lift - box.min.z;
  mesh.updateMatrixWorld(true);
}

/** Centres the model's footprint on the plate. */
export function centerOnPlate(mesh) {
  const box = worldBox(mesh);
  const c = box.getCenter(new THREE.Vector3());
  mesh.position.x -= c.x;
  mesh.position.y -= c.y;
  mesh.updateMatrixWorld(true);
}

/**
 * Lays all models out in rows on the plate, largest first, with a gap
 * between their footprints. Returns false if they do not all fit.
 */
export function arrangeModels(meshes, volume, gap = 5) {
  const items = meshes
    .map((m) => ({ m, box: worldBox(m) }))
    .map((it) => ({ ...it, w: it.box.max.x - it.box.min.x, d: it.box.max.y - it.box.min.y }))
    .sort((a, b) => b.d - a.d);

  let x = -volume.x / 2;
  let y = -volume.y / 2;
  let rowDepth = 0;
  let fits = true;
  for (const it of items) {
    if (x + it.w > volume.x / 2 && x > -volume.x / 2) {
      x = -volume.x / 2;
      y += rowDepth + gap;
      rowDepth = 0;
    }
    it.m.position.x += x - it.box.min.x;
    it.m.position.y += y - it.box.min.y;
    it.m.updateMatrixWorld(true);
    if (x + it.w > volume.x / 2 || y + it.d > volume.y / 2) fits = false;
    x += it.w + gap;
    rowDepth = Math.max(rowDepth, it.d);
  }

  // Centre the whole arrangement on the plate.
  const all = new THREE.Box3();
  for (const it of items) all.union(worldBox(it.m));
  const c = all.getCenter(new THREE.Vector3());
  for (const it of items) {
    it.m.position.x -= c.x;
    it.m.position.y -= c.y;
    it.m.updateMatrixWorld(true);
  }
  return fits;
}

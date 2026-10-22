import * as THREE from 'three';

/**
 * Collects every mesh below `root` into one flat, non-indexed BufferGeometry
 * that only carries positions and face normals. World transforms are baked in,
 * mirrored transforms get their winding corrected.
 */
export function geometryFromObject(root) {
  root.updateMatrixWorld(true);
  const chunks = [];
  let total = 0;

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const src = obj.geometry;
    const pos = src?.getAttribute('position');
    if (!pos) return;
    const out = trianglesToArray(src, pos);
    if (out.length === 0) return;
    transformPositions(out, obj.matrixWorld);
    chunks.push(out);
    total += out.length;
  });

  if (total === 0) return null;
  const merged = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return geometryFromPositions(merged);
}

/** Builds a display-ready geometry (positions + flat normals) from a triangle soup. */
export function geometryFromPositions(positions) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function trianglesToArray(geometry, pos) {
  const index = geometry.index;
  const start = geometry.drawRange.start;
  const limit = index ? index.count : pos.count;
  const end = Math.min(limit, start + (Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : limit));
  const count = end - start - ((end - start) % 3);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const v = index ? index.getX(start + i) : start + i;
    out[i * 3] = pos.getX(v);
    out[i * 3 + 1] = pos.getY(v);
    out[i * 3 + 2] = pos.getZ(v);
  }
  return out;
}

function transformPositions(arr, matrix) {
  const e = matrix.elements;
  for (let i = 0; i < arr.length; i += 3) {
    const x = arr[i], y = arr[i + 1], z = arr[i + 2];
    arr[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    arr[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    arr[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  if (matrix.determinant() < 0) flipWinding(arr);
}

function flipWinding(arr) {
  for (let i = 0; i < arr.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const t = arr[i + 3 + k];
      arr[i + 3 + k] = arr[i + 6 + k];
      arr[i + 6 + k] = t;
    }
  }
}

/**
 * Moves the geometry so that its bounding box is centred on the origin.
 * Returns the offset that was subtracted.
 */
export function centerGeometry(geometry) {
  geometry.computeBoundingBox();
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return center;
}

/** Enclosed volume in mm³ via the divergence theorem (signed tetrahedra). */
export function meshVolume(geometry) {
  const p = geometry.getAttribute('position').array;
  let v = 0;
  for (let i = 0; i < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
    const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return Math.abs(v / 6);
}

/** Triangle soup of a mesh in world space (used for export). */
export function worldPositions(mesh) {
  mesh.updateMatrixWorld(true);
  const src = mesh.geometry.getAttribute('position').array;
  const out = new Float32Array(src);
  transformPositions(out, mesh.matrixWorld);
  return out;
}

/** Exact world-space bounding box (respects rotation, unlike Box3 of the local box). */
export function worldBox(mesh) {
  return new THREE.Box3().setFromObject(mesh, true);
}

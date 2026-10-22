import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { unzipSync, strFromU8, zipSync, strToU8 } from 'fflate';
import { writeStl, write3mf, weld } from '../src/io/exporters.js';
import { importModel, threeMfUnitScale, extensionOf, ImportError } from '../src/io/importers.js';
import { meshVolume, geometryFromObject } from '../src/core/geometry.js';

function cubeSoup(size = 10) {
  const g = new THREE.BoxGeometry(size, size, size).toNonIndexed();
  return new Float32Array(g.getAttribute('position').array);
}

const OBJ_CUBE = `
v 0 0 0
v 10 0 0
v 10 10 0
v 0 10 0
v 0 0 10
v 10 0 10
v 10 10 10
v 0 10 10
f 1 3 2
f 1 4 3
f 5 6 7
f 5 7 8
f 1 2 6
f 1 6 5
f 2 3 7
f 2 7 6
f 3 4 8
f 3 8 7
f 4 1 5
f 4 5 8
`;

describe('STL export', () => {
  it('writes a binary STL that three can read back', () => {
    const soup = cubeSoup();
    const bytes = writeStl([soup]);
    expect(bytes.length).toBe(84 + 12 * 50);
    const g = new STLLoader().parse(bytes.buffer);
    expect(g.getAttribute('position').count).toBe(36);
    expect(meshVolume(g)).toBeCloseTo(1000, 3);
  });
});

describe('3MF export', () => {
  it('packages a welded mesh in millimetres', () => {
    const zip = write3mf([{ name: 'Würfel <1>', positions: cubeSoup() }]);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toContain('3D/3dmodel.model');
    const model = strFromU8(files['3D/3dmodel.model']);
    expect(model).toContain('unit="millimeter"');
    expect(model).toContain('name="Würfel &lt;1&gt;"');
    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(threeMfUnitScale(zip.buffer)).toBe(1);
  });

  it('reads the unit attribute of foreign 3MF files', () => {
    const zip = zipSync({ '3D/3dmodel.model': strToU8('<?xml version="1.0"?><model unit="inch" xmlns="x"></model>') });
    expect(threeMfUnitScale(zip.buffer)).toBe(25.4);
  });
});

describe('weld', () => {
  it('drops degenerate triangles', () => {
    const { vertices, triangles } = weld(new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 0]));
    expect(vertices.length).toBe(6);
    expect(triangles.length).toBe(0);
  });
});

describe('import', () => {
  it('reads STL as Z-up millimetres', async () => {
    const { geometry, format } = await importModel('teil.STL', writeStl([cubeSoup(20)]).buffer);
    expect(format).toBe('STL');
    expect(meshVolume(geometry)).toBeCloseTo(8000, 2);
  });

  it('rotates Y-up OBJ files to Z-up', async () => {
    const buf = new TextEncoder().encode(OBJ_CUBE + 'v 0 30 0\nv 1 30 0\nv 0 30 1\nf 9 10 11\n').buffer;
    const { geometry } = await importModel('figur.obj', buf);
    geometry.computeBoundingBox();
    // The 30 mm tall spike along OBJ's Y must end up along Z.
    expect(geometry.boundingBox.max.z).toBeCloseTo(30, 4);
    expect(geometry.boundingBox.max.y).toBeCloseTo(0, 4);
  });

  it('reads ASCII PLY with faces', async () => {
    const ply = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
element face 4
property list uchar int vertex_indices
end_header
0 0 0
10 0 0
0 10 0
0 0 10
3 0 2 1
3 0 1 3
3 0 3 2
3 1 2 3
`;
    const { geometry } = await importModel('scan.ply', new TextEncoder().encode(ply).buffer);
    expect(geometry.getAttribute('position').count).toBe(12);
    expect(meshVolume(geometry)).toBeCloseTo(1000 / 6, 3);
  });

  it('rejects unknown formats with a readable message', async () => {
    await expect(importModel('foto.jpg', new ArrayBuffer(4))).rejects.toBeInstanceOf(ImportError);
    expect(extensionOf('a.b.StP')).toBe('stp');
  });
});

describe('geometryFromObject', () => {
  it('bakes transforms and fixes mirrored winding', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10));
    mesh.scale.set(-2, 1, 1);
    const g = geometryFromObject(mesh);
    g.computeBoundingBox();
    expect(g.boundingBox.max.x).toBeCloseTo(10, 5);
    // Positive signed volume means outward-facing triangles after mirroring.
    const p = g.getAttribute('position').array;
    let v = 0;
    for (let i = 0; i < p.length; i += 9) {
      const a = new THREE.Vector3(p[i], p[i + 1], p[i + 2]);
      const b = new THREE.Vector3(p[i + 3], p[i + 4], p[i + 5]);
      const c = new THREE.Vector3(p[i + 6], p[i + 7], p[i + 8]);
      v += a.dot(b.cross(c)) / 6;
    }
    expect(v).toBeCloseTo(2000, 3);
  });
});

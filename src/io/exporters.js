import { zipSync, strToU8 } from 'fflate';

/**
 * Binary STL from one or more triangle soups (Float32Array, 9 floats per triangle).
 * Normals are computed per facet.
 */
export function writeStl(soups, header = 'SLA Support Generator') {
  const triCount = soups.reduce((n, s) => n + s.length / 9, 0);
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const head = strToU8(header.slice(0, 80));
  new Uint8Array(buffer, 0, head.length).set(head);
  view.setUint32(80, triCount, true);

  let o = 84;
  for (const p of soups) {
    for (let i = 0; i < p.length; i += 9) {
      const ux = p[i + 3] - p[i], uy = p[i + 4] - p[i + 1], uz = p[i + 5] - p[i + 2];
      const vx = p[i + 6] - p[i], vy = p[i + 7] - p[i + 1], vz = p[i + 8] - p[i + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      view.setFloat32(o, nx / len, true);
      view.setFloat32(o + 4, ny / len, true);
      view.setFloat32(o + 8, nz / len, true);
      o += 12;
      for (let k = 0; k < 9; k++, o += 4) view.setFloat32(o, p[i + k], true);
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return new Uint8Array(buffer);
}

/**
 * 3MF package with one object per entry. Vertices are welded so the result
 * is a proper indexed mesh, as the 3MF spec expects.
 * @param {{name: string, positions: Float32Array}[]} objects
 */
export function write3mf(objects) {
  const resources = [];
  const items = [];
  objects.forEach((obj, i) => {
    const id = i + 1;
    const { vertices, triangles } = weld(obj.positions);
    const v = [];
    for (let k = 0; k < vertices.length; k += 3) {
      v.push(`<vertex x="${num(vertices[k])}" y="${num(vertices[k + 1])}" z="${num(vertices[k + 2])}"/>`);
    }
    const t = [];
    for (let k = 0; k < triangles.length; k += 3) {
      t.push(`<triangle v1="${triangles[k]}" v2="${triangles[k + 1]}" v3="${triangles[k + 2]}"/>`);
    }
    resources.push(
      `<object id="${id}" name="${xml(obj.name)}" type="model"><mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh></object>`,
    );
    items.push(`<item objectid="${id}"/>`);
  });

  const model =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">' +
    '<metadata name="Application">SLA Support Generator</metadata>' +
    `<resources>${resources.join('')}</resources><build>${items.join('')}</build></model>`;

  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
    ),
    '3D/3dmodel.model': strToU8(model),
  });
}

/** Merges identical vertices of a triangle soup; drops triangles that collapse. */
export function weld(positions) {
  const map = new Map();
  const vertices = [];
  const triangles = [];
  const ids = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 9) {
    for (let k = 0; k < 3; k++) {
      const x = positions[i + k * 3], y = positions[i + k * 3 + 1], z = positions[i + k * 3 + 2];
      const key = `${num(x)},${num(y)},${num(z)}`;
      let id = map.get(key);
      if (id === undefined) {
        id = vertices.length / 3;
        map.set(key, id);
        vertices.push(x, y, z);
      }
      ids[k] = id;
    }
    if (ids[0] !== ids[1] && ids[1] !== ids[2] && ids[0] !== ids[2]) triangles.push(ids[0], ids[1], ids[2]);
  }
  return { vertices, triangles };
}

function num(n) {
  return String(Math.round(n * 1e5) / 1e5);
}

function xml(s) {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]);
}

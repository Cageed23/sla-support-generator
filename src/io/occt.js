import * as THREE from 'three';

/**
 * STEP / IGES / BREP import via OpenCascade compiled to WebAssembly
 * (occt-import-js). The ~7 MB WASM file is only fetched when a CAD file is
 * opened, and the conversion runs in a worker so the UI stays responsive.
 */
const OCCT_DIR = `${import.meta.env?.BASE_URL ?? './'}vendor/occt/`;

export async function readCadFile(format, buffer) {
  const result = await runWorker(format, new Uint8Array(buffer));
  if (!result || !result.success) {
    throw new Error('Die CAD-Datei konnte nicht gelesen werden. Ist sie beschädigt oder leer?');
  }
  const group = new THREE.Group();
  for (const m of result.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.index) g.setIndex(m.index.array);
    group.add(new THREE.Mesh(g));
  }
  return group;
}

function runWorker(format, content) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL(OCCT_DIR + 'occt-import-js-worker.js', document.baseURI));
    } catch (err) {
      reject(new Error('Der CAD-Import konnte nicht gestartet werden: ' + err.message));
      return;
    }
    worker.onmessage = (ev) => {
      worker.terminate();
      resolve(ev.data);
    };
    worker.onerror = (ev) => {
      worker.terminate();
      reject(new Error('Der CAD-Import ist fehlgeschlagen: ' + (ev.message || 'unbekannter Fehler')));
    };
    worker.postMessage(
      {
        format,
        buffer: content,
        // Fine tessellation: 0.1 % of the bounding box, 0.5 rad.
        params: { linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 },
      },
      [content.buffer],
    );
  });
}

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AMFLoader } from 'three/addons/loaders/AMFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { unzipSync, strFromU8 } from 'fflate';
import { geometryFromObject, geometryFromPositions } from '../core/geometry.js';
import { readCadFile } from './occt.js';

/**
 * Every format the app understands. `up` is the up axis the format uses by
 * convention; everything is converted to the printer's Z-up, millimetre space.
 */
export const FORMATS = {
  stl: { label: 'STL', up: 'z' },
  obj: { label: 'OBJ', up: 'y' },
  '3mf': { label: '3MF', up: 'z' },
  ply: { label: 'PLY', up: 'z' },
  gltf: { label: 'glTF', up: 'y' },
  glb: { label: 'GLB', up: 'y' },
  amf: { label: 'AMF', up: 'z' },
  fbx: { label: 'FBX', up: 'y' },
  step: { label: 'STEP', up: 'z', cad: 'step' },
  stp: { label: 'STEP', up: 'z', cad: 'step' },
  iges: { label: 'IGES', up: 'z', cad: 'iges' },
  igs: { label: 'IGES', up: 'z', cad: 'iges' },
  brep: { label: 'BREP', up: 'z', cad: 'brep' },
};

export const ACCEPT = Object.keys(FORMATS).map((e) => '.' + e).join(',');

export function extensionOf(name) {
  const m = /\.([^.]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export class ImportError extends Error {}

/**
 * Reads a model file.
 * @param {string} name file name (used to detect the format)
 * @param {ArrayBuffer} buffer file content
 * @returns {Promise<{geometry: THREE.BufferGeometry, format: string, notes: string[]}>}
 */
export async function importModel(name, buffer) {
  const ext = extensionOf(name);
  const format = FORMATS[ext];
  if (!format) {
    throw new ImportError(`Das Format „.${ext}“ wird nicht unterstützt. Unterstützt: ${uniqueLabels().join(', ')}.`);
  }

  const notes = [];
  let root;
  let unitScale = 1;

  switch (ext) {
    case 'stl':
      root = meshOf(new STLLoader().parse(buffer));
      break;
    case 'obj':
      root = new OBJLoader().parse(new TextDecoder().decode(buffer));
      break;
    case '3mf':
      root = new ThreeMFLoader().parse(buffer);
      unitScale = threeMfUnitScale(buffer);
      if (unitScale !== 1) notes.push(`Einheit aus 3MF übernommen (×${unitScale}).`);
      break;
    case 'ply': {
      const g = new PLYLoader().parse(buffer);
      if (!g.index && g.getAttribute('position').count % 3 !== 0) {
        throw new ImportError('Diese PLY-Datei enthält nur eine Punktwolke ohne Flächen. Für den Druck wird ein geschlossenes Dreiecksnetz gebraucht.');
      }
      root = meshOf(g);
      break;
    }
    case 'gltf':
    case 'glb':
      root = await parseGltf(buffer);
      unitScale = 1000; // glTF is defined in metres
      notes.push('glTF verwendet Meter, das Modell wurde in Millimeter umgerechnet.');
      break;
    case 'amf':
      root = new AMFLoader().parse(buffer);
      break;
    case 'fbx': {
      root = new FBXLoader().parse(buffer, '');
      // FBX stores centimetres scaled by UnitScaleFactor.
      unitScale = 10 * (root.userData.unitScaleFactor || 1);
      if (unitScale !== 1) notes.push(`FBX-Einheit umgerechnet (×${round(unitScale)}).`);
      break;
    }
    default:
      root = await readCadFile(format.cad, buffer);
      notes.push(`${format.label}-Flächen wurden in ein Dreiecksnetz umgerechnet.`);
  }

  const wrapper = new THREE.Group();
  wrapper.add(root);
  if (format.up === 'y') wrapper.rotation.x = Math.PI / 2;
  wrapper.scale.setScalar(unitScale);

  const geometry = geometryFromObject(wrapper);
  if (!geometry) throw new ImportError('In der Datei wurden keine Flächen gefunden.');
  return { geometry, format: format.label, notes };
}

function meshOf(geometry) {
  return new THREE.Mesh(geometry);
}

function uniqueLabels() {
  return [...new Set(Object.values(FORMATS).map((f) => f.label))];
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

function parseGltf(buffer) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().parse(
      buffer,
      '',
      (gltf) => resolve(gltf.scene),
      (err) => {
        const msg = String(err?.message || err);
        if (/draco/i.test(msg)) reject(new ImportError('Draco-komprimierte glTF-Dateien werden noch nicht unterstützt.'));
        else if (/load|fetch|uri/i.test(msg)) reject(new ImportError('Diese .gltf-Datei verweist auf externe Dateien. Bitte als .glb (eine Datei) exportieren.'));
        else reject(err);
      },
    );
  });
}

const UNIT_SCALE = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

/** 3MF stores its unit on the <model> element; three's loader ignores it. */
export function threeMfUnitScale(buffer) {
  try {
    const files = unzipSync(new Uint8Array(buffer), { filter: (f) => /\.model$/i.test(f.name) });
    for (const data of Object.values(files)) {
      const head = strFromU8(data.subarray(0, 4096));
      const m = /<model[^>]*\bunit\s*=\s*"([a-z]+)"/i.exec(head);
      if (m) return UNIT_SCALE[m[1].toLowerCase()] ?? 1;
    }
  } catch {
    // fall through to the 3MF default
  }
  return 1;
}

/** Converts a raw triangle array (e.g. from a worker) into a geometry. */
export { geometryFromPositions };

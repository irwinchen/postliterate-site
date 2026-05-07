// Pre-decimate the FreeSurfer fsaverage Desikan-Killiany pial meshes.
// Reads from public/brain-mesh/pial-dk/, writes simplified .obj files to
// public/brain-mesh/pial-dk-lo/. Run once. The renderer loads from the
// pre-decimated dir at runtime and skips the SimplifyModifier work.
//
// Usage: node scripts/decimate-brain-mesh.mjs

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC_DIR  = 'public/brain-mesh/pial-dk';
const DEST_DIR = 'public/brain-mesh/pial-dk-lo';
const RETAIN   = 0.15;     // fraction of vertices to keep per region

await mkdir(DEST_DIR, { recursive: true });

const loader     = new OBJLoader();
const exporter   = new OBJExporter();
const simplifier = new SimplifyModifier();

const files = (await readdir(SRC_DIR))
  .filter((f) => f.endsWith('.obj'))
  .sort();

console.log(`Decimating ${files.length} regions @ ${(RETAIN * 100).toFixed(0)}% retention...`);
const t0 = Date.now();
let totalIn = 0, totalOut = 0;

for (const file of files) {
  const srcText = await readFile(path.join(SRC_DIR, file), 'utf8');
  const obj = loader.parse(srcText);

  obj.traverse((child) => {
    if (!child.isMesh) return;
    const verts = child.geometry.attributes.position.count;
    const target = Math.max(60, Math.floor(verts * RETAIN));
    const remove = Math.max(0, verts - target);
    totalIn += verts;
    if (remove > 0) {
      const simplified = simplifier.modify(child.geometry, remove);
      child.geometry.dispose();
      child.geometry = simplified;
    }
    child.geometry.computeVertexNormals();
    totalOut += child.geometry.attributes.position.count;
  });

  // OBJExporter writes full IEEE precision; round floats to 4 decimals
  // (still <0.0001 mm — well below mesh-decimation noise).
  const exported = exporter.parse(obj).replace(
    /-?\d+\.\d+/g,
    (m) => parseFloat(m).toFixed(4),
  );
  await writeFile(path.join(DEST_DIR, file), exported);
  process.stdout.write('.');
}

// Manifest for the renderer to enumerate.
await writeFile(
  path.join(DEST_DIR, 'manifest.txt'),
  files.join('\n') + '\n',
);

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s. Vertex count: ${totalIn.toLocaleString()} → ${totalOut.toLocaleString()} (${((totalOut / totalIn) * 100).toFixed(1)}%).`);
console.log(`Output: ${DEST_DIR}/`);

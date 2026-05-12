/**
 * figures.mjs — Phase 7
 *
 * Reads the project registry at scripts/dashboard/figures.json and
 * decorates each entry with on-disk metadata for files in
 * public/images/figures/. Files are served by the dashboard at
 * /dashboard/figures/<filename> (route added in scripts/admin.mjs).
 *
 * Registry shape (see figures.json):
 *   [{ id, title, credit?, images: [{ file, caption? }] }]
 *
 * Output shape:
 *   {
 *     total_projects, total_images, missing_images,
 *     projects: [{
 *       id, title, credit,
 *       images: [{ file, caption?, url, exists, mtime, size_kb }],
 *       cover: <first-existing image, else first overall, else null>,
 *       image_count: N,
 *       has_any: bool
 *     }]
 *   }
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(__dirname, '..', 'figures.json');
const FIGURES_DIR = join(__dirname, '..', '..', '..', 'public', 'images', 'figures');

function decorateImage(img) {
  const fullPath = join(FIGURES_DIR, img.file);
  const exists = existsSync(fullPath);
  let mtime = null;
  let size_kb = null;
  if (exists) {
    try {
      const s = statSync(fullPath);
      mtime = new Date(s.mtimeMs).toISOString();
      size_kb = Math.round(s.size / 1024);
    } catch {
      // fall through with nulls
    }
  }
  return {
    file: img.file,
    caption: img.caption || null,
    url: '/dashboard/figures/' + encodeURIComponent(img.file),
    exists,
    mtime,
    size_kb,
  };
}

export async function getFigures() {
  let registry;
  try {
    registry = JSON.parse(readFileSync(REGISTRY_PATH, 'utf8'));
  } catch (err) {
    return {
      total_projects: 0,
      total_images: 0,
      missing_images: 0,
      projects: [],
      error: `figures.json: ${err.message}`,
    };
  }
  if (!Array.isArray(registry)) {
    return {
      total_projects: 0,
      total_images: 0,
      missing_images: 0,
      projects: [],
      error: 'figures.json must be an array of project entries',
    };
  }

  const projects = registry.map((entry) => {
    const images = (entry.images || []).map(decorateImage);
    const firstExisting = images.find((i) => i.exists) || null;
    const cover = firstExisting || images[0] || null;
    return {
      id: entry.id || entry.title,
      title: entry.title || entry.id || 'Untitled',
      credit: entry.credit || null,
      // Optional path on the live site that this figure renders on, e.g.
      // "/brain". The dashboard UI exposes it as a "View live →" link;
      // resolution to a full URL happens in the browser (combines with the
      // current host + Astro dev port).
      page: entry.page || null,
      images,
      cover,
      image_count: images.length,
      has_any: !!firstExisting,
    };
  });

  let totalImages = 0;
  let missingImages = 0;
  for (const p of projects) {
    totalImages += p.images.length;
    for (const img of p.images) if (!img.exists) missingImages++;
  }

  return {
    total_projects: projects.length,
    total_images: totalImages,
    missing_images: missingImages,
    projects,
  };
}

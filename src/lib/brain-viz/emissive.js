// Emissive color math for the brain viz.
// Pure functions: no Three.js, no DOM. Colors are {r, g, b} floats in 0..1.

const SINGLE_MODE_INTENSITY = 0.6;

export function hexToRgb(hex) {
  if (typeof hex !== 'string') throw new Error(`hexToRgb: expected string, got ${typeof hex}`);
  const trimmed = hex.startsWith('#') ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    throw new Error(`hexToRgb: expected 6-digit hex, got "${hex}"`);
  }
  return {
    r: parseInt(trimmed.slice(0, 2), 16) / 255,
    g: parseInt(trimmed.slice(2, 4), 16) / 255,
    b: parseInt(trimmed.slice(4, 6), 16) / 255,
  };
}

// Given the modes a parcel belongs to and which modes are currently active,
// compute the additive emissive color with √N intensity tapering.
//
// activeMembers = parcelModes ∩ activeModes ∩ keys(modeColors)
// k             = 0.6 / √|activeMembers|
// emissive      = Σ (modeColor[m] × k)  for m in activeMembers
export function computeParcelEmissive(parcelModes, activeModes, modeColors) {
  const activeSet = new Set(activeModes);
  const members = parcelModes.filter(
    (m) => activeSet.has(m) && Object.prototype.hasOwnProperty.call(modeColors, m),
  );

  if (members.length === 0) return { r: 0, g: 0, b: 0 };

  const k = SINGLE_MODE_INTENSITY / Math.sqrt(members.length);
  let r = 0, g = 0, b = 0;
  for (const m of members) {
    const c = modeColors[m];
    r += c.r * k;
    g += c.g * k;
    b += c.b * k;
  }
  return { r, g, b };
}

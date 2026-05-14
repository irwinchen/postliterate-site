import { describe, it, expect } from 'vitest';
import { loadPaperContent } from '../../src/lib/brain-viz/paper-content.js';
import { loadParcelRegistry } from '../../src/lib/brain-viz/parcel-registry.js';

const FIXTURE_REGISTRY = {
  'cohen2002.VWFA': {
    label: 'Visual Word Form Area',
    centroid: [-0.43, -0.35, -0.30],
    radius: 0.04,
  },
  'lang.LanB-IFG-L': {
    label: "IFG (Broca's)",
    centroid: [-0.68, 0.05, 0.45],
    radius: 0.11,
  },
};

function reg() {
  return loadParcelRegistry(FIXTURE_REGISTRY);
}

describe('loadPaperContent', () => {
  it('returns null for missing or malformed input', () => {
    const r = reg();
    expect(loadPaperContent(null, r)).toBeNull();
    expect(loadPaperContent({}, r)).toBeNull();
    expect(loadPaperContent({ sections: 'oops' }, r)).toBeNull();
    expect(loadPaperContent({ sections: [] }, r)).toBeNull();
  });

  it('drops ref segments whose parcelId is not in the registry', () => {
    const out = loadPaperContent(
      {
        sections: [{
          level: 2, heading: 'Intro',
          paragraphs: [{
            segments: [
              { type: 'text', value: 'The ' },
              { type: 'ref', value: 'VWFA', parcelId: 'cohen2002.VWFA' },
              { type: 'text', value: ' and the ' },
              { type: 'ref', value: 'Hippocampus', parcelId: 'made.up.id' },
              { type: 'text', value: '.' },
            ],
          }],
        }],
      },
      reg(),
    );
    expect(out).not.toBeNull();
    const segs = out.sections[0].paragraphs[0].segments;
    expect(segs.filter((s) => s.type === 'ref').map((s) => s.parcelId)).toEqual(['cohen2002.VWFA']);
    expect(out.parcelIds.has('cohen2002.VWFA')).toBe(true);
    expect(out.parcelIds.has('made.up.id')).toBe(false);
  });

  it('drops paragraphs with no remaining refs after sanitisation', () => {
    const out = loadPaperContent(
      {
        sections: [{
          level: 2, heading: 'Intro',
          paragraphs: [
            { segments: [{ type: 'text', value: 'No refs in here.' }] }, // dropped
            {
              segments: [
                { type: 'text', value: 'Has ' },
                { type: 'ref', value: 'IFG', parcelId: 'lang.LanB-IFG-L' },
              ],
            },
          ],
        }],
      },
      reg(),
    );
    expect(out.sections[0].paragraphs.length).toBe(1);
  });

  it('drops sections that end up with zero paragraphs and zero subsections', () => {
    const out = loadPaperContent(
      {
        sections: [
          {
            level: 2, heading: 'Empty',
            paragraphs: [{ segments: [{ type: 'text', value: 'no refs' }] }],
          },
          {
            level: 2, heading: 'Kept',
            paragraphs: [{
              segments: [{ type: 'ref', value: 'VWFA', parcelId: 'cohen2002.VWFA' }],
            }],
          },
        ],
      },
      reg(),
    );
    expect(out.sections.length).toBe(1);
    expect(out.sections[0].heading).toBe('Kept');
  });

  it('keeps a top section when only its subsection has refs', () => {
    const out = loadPaperContent(
      {
        sections: [{
          level: 2, heading: 'Methods',
          paragraphs: [],
          subsections: [{
            level: 3, heading: 'fMRI',
            paragraphs: [{
              segments: [{ type: 'ref', value: 'VWFA', parcelId: 'cohen2002.VWFA' }],
            }],
          }],
        }],
      },
      reg(),
    );
    expect(out.sections.length).toBe(1);
    expect(out.sections[0].subsections.length).toBe(1);
    expect(out.sections[0].subsections[0].heading).toBe('fMRI');
  });

  it('clamps top-level depth to 2 and subsection depth to 3', () => {
    const out = loadPaperContent(
      {
        sections: [{
          level: 99, heading: 'Weird',
          paragraphs: [{
            segments: [{ type: 'ref', value: 'IFG', parcelId: 'lang.LanB-IFG-L' }],
          }],
          subsections: [{
            level: 1, heading: 'Also weird',
            paragraphs: [{
              segments: [{ type: 'ref', value: 'VWFA', parcelId: 'cohen2002.VWFA' }],
            }],
          }],
        }],
      },
      reg(),
    );
    expect(out.sections[0].level).toBe(2);
    expect(out.sections[0].subsections[0].level).toBe(3);
  });

  it('collects every referenced parcelId in the flat Set', () => {
    const out = loadPaperContent(
      {
        sections: [
          {
            level: 2, heading: 'A',
            paragraphs: [{
              segments: [{ type: 'ref', value: 'VWFA', parcelId: 'cohen2002.VWFA' }],
            }],
            subsections: [{
              level: 3, heading: 'A.1',
              paragraphs: [{
                segments: [{ type: 'ref', value: 'IFG', parcelId: 'lang.LanB-IFG-L' }],
              }],
            }],
          },
        ],
      },
      reg(),
    );
    expect([...out.parcelIds].sort()).toEqual(['cohen2002.VWFA', 'lang.LanB-IFG-L']);
  });
});

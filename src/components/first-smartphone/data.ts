/**
 * Shared dataset for the "first smartphone by age" figures.
 *
 * y = % of children who own their own smartphone; x = age band (6–7 … 12–13).
 * Line style / confidence encodes data provenance:
 *   'solid' = single-year / true-band data from a primary source
 *   'soft'  = includes interpolated, grade-converted, or older figures
 *
 * All numbers are hand-entered from primary sources (see each `source`) and
 * cross-checked in chat before build. China / India / most of Africa are
 * deliberately excluded (see `FOOTNOTE`) because their national data reports
 * household access or a single school-stage figure, not personal ownership by
 * age.
 *
 * Consumed by both FirstSmartphoneAge.astro (line chart) and
 * FirstSmartphoneIsotype.astro (Neurath pictogram).
 */

// Age bands on the x-axis. `null` in a country's `values` = no reported figure.
export const BANDS = ['6–7', '8–9', '10–11', '12–13'] as const;

export type Confidence = 'solid' | 'soft';

export interface Country {
  id: string;
  name: string;
  flag: string;
  color: string;
  confidence: Confidence;
  /** Ownership % per BANDS index; null = no age-specific figure. */
  values: (number | null)[];
  source: string;
  note: string;
}

export const COUNTRIES: Country[] = [
  {
    id: 'us',
    name: 'United States',
    flag: '🇺🇸',
    color: '#E53E33',
    confidence: 'solid',
    values: [null, 31, 40, 70],
    source: 'Common Sense Census (2021)',
    note: 'Single-year survey, averaged to bands.',
  },
  {
    id: 'de',
    name: 'Germany',
    flag: '🇩🇪',
    color: '#549E44',
    confidence: 'solid',
    values: [9, 27, 58, 81],
    source: 'KIM-Studie / mpfs (2022)',
    note: 'True age bands from the primary source.',
  },
  {
    id: 'jp',
    name: 'Japan',
    flag: '🇯🇵',
    color: '#3B6DB4',
    confidence: 'solid',
    values: [11, 29, 41, 75],
    source: 'Docomo Mobile Society Inst. (2024)',
    note: 'Self-owned smartphone, mapped grade → age (G1 = age 6).',
  },
  {
    id: 'gb',
    name: 'United Kingdom',
    flag: '🇬🇧',
    color: '#C9822E',
    confidence: 'soft',
    values: [24, 48, 70, 94],
    source: 'Ofcom (2024)',
    note: 'Anchored at ages 5–7, 10, 11; ages 8–9 and 12–13 interpolated.',
  },
  {
    id: 'kr',
    name: 'South Korea',
    flag: '🇰🇷',
    color: '#7A5FA3',
    confidence: 'soft',
    values: [null, 38, 81, 95],
    source: 'Korea Press Fdn / academic (~2019)',
    note: 'Converted from school grades; older data.',
  },
  {
    id: 'au',
    name: 'Australia',
    flag: '🇦🇺',
    color: '#3A3A3A',
    confidence: 'soft',
    values: [null, 15, 28, 76],
    source: 'ACMA (2020)',
    note: 'Any mobile phone (not smartphone-specific); older data.',
  },
];

export const FOOTNOTE =
  'China, India, and most of Africa are excluded: their national data reports shared-household access or a single school-stage figure (e.g. China ~64% of all primary-school children), not personal smartphone ownership by age.';

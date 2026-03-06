/** Replace straight quotes/apostrophes with typographic (curly) equivalents. */
export function smartQuotes(s: string): string {
  return s
    .replace(/(^|[\s(\u2014\u2013-])"/g, '$1\u201C')
    .replace(/"/g, '\u201D')
    .replace(/(^|[\s(\u2014\u2013-])'/g, '$1\u2018')
    .replace(/'/g, '\u2019');
}

// Greek → Latin transliteration (ELOT 743) for text that must be Latin: FPL fields, the PDFs of
// the forms sent to HCAA. Shared by the client and the API.
const GREEK: Record<string, string> = {
  Α: 'A', Β: 'V', Γ: 'G', Δ: 'D', Ε: 'E', Ζ: 'Z', Η: 'I', Θ: 'TH', Ι: 'I', Κ: 'K', Λ: 'L', Μ: 'M', Ν: 'N', Ξ: 'X',
  Ο: 'O', Π: 'P', Ρ: 'R', Σ: 'S', Τ: 'T', Υ: 'Y', Φ: 'F', Χ: 'CH', Ψ: 'PS', Ω: 'O',
};
const VOWELS = new Set('ΑΕΗΙΟΥΩ');
/** Voiced consonants: ΑΥ/ΕΥ/ΗΥ before these (or a vowel) are AV/EV/IV, otherwise AF/EF/IF. */
const VOICED = new Set('ΒΓΔΖΛΜΝΡ');

/**
 * Greek → Latin by ELOT 743 (the transliteration of Greek passports and licences), upper case:
 * ΑΥ/ΕΥ/ΗΥ → AV/EV/IV before a vowel or voiced consonant, AF/EF/IF before a voiceless one or at
 * the end of a word (unless the Υ has a diaeresis or the first vowel the accent: ΆΥ, ΑΫ → AY);
 * ΟΥ → OU; ΓΓ → NG, ΓΞ → NX, ΓΧ → NCH (ΓΚ → GK); ΜΠ → B and ΝΤ → D at the start of a word, MP
 * and NT inside it; Θ TH, Χ CH, Ψ PS, Η I, Υ Y; every other letter one to one. Latin text passes
 * through upper-cased; accents are dropped.
 */
export function transliterate(s: string, opts: { keepCase?: boolean } = {}): string {
  // One entry per base character, with its accent/diaeresis marks (from the NFD form).
  const chars: { c: string; acc: boolean; dia: boolean; lower: boolean }[] = [];
  for (const ch of (s || '').normalize('NFD')) {
    if (/[\u0300-\u036f]/.test(ch)) {
      const last = chars[chars.length - 1];
      if (last) { if (ch === '\u0308') last.dia = true; else last.acc = true; }
      continue;
    }
    const up = ch.toUpperCase().replace('ς', 'Σ');
    chars.push({ c: up, acc: false, dia: false, lower: ch !== up && ch.toLowerCase() === ch || ch === 'ς' });
  }
  const greek = (i: number) => i >= 0 && i < chars.length && /[Α-Ω]/.test(chars[i].c);
  let out = '';
  /** Latin for char i, in its case when keepCase ('TH' → 'th' / 'Th'). */
  const cased = (i: number, latin: string) => {
    if (!opts.keepCase) return latin;
    if (chars[i].lower) return latin.toLowerCase();
    const next = chars[i + 1];
    return next && next.lower ? latin.charAt(0) + latin.slice(1).toLowerCase() : latin;
  };
  for (let i = 0; i < chars.length; i++) {
    const { c, acc } = chars[i];
    if (!/[Α-Ω]/.test(c)) { out += opts.keepCase && chars[i].lower ? c.toLowerCase() : c; continue; }
    const n = chars[i + 1];
    const nc = n && greek(i + 1) ? n.c : '';
    const wordStart = !greek(i - 1);
    // Diphthongs with Υ: AY EY HY, OY.
    if ((c === 'Α' || c === 'Ε' || c === 'Η') && nc === 'Υ' && !n.dia && !acc) {
      const after = greek(i + 2) ? chars[i + 2].c : '';
      const voiced = after !== '' && (VOWELS.has(after) || VOICED.has(after));
      out += cased(i, (c === 'Α' ? 'A' : c === 'Ε' ? 'E' : 'I') + (voiced ? 'V' : 'F'));
      i++;
      continue;
    }
    if (c === 'Ο' && nc === 'Υ' && !n.dia && !acc) { out += cased(i, 'OU'); i++; continue; }
    if (c === 'Γ' && (nc === 'Γ' || nc === 'Ξ' || nc === 'Χ')) { out += cased(i, 'N'); continue; }
    if (wordStart && c === 'Μ' && nc === 'Π') { out += cased(i, 'B'); i++; continue; }
    if (wordStart && c === 'Ν' && nc === 'Τ') { out += cased(i, 'D'); i++; continue; }
    out += cased(i, GREEK[c] ?? '');
  }
  return out;
}


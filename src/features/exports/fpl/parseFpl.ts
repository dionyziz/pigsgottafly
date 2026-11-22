// The ICAO FPL message read back into the form's fields, so a filed plan (only its message is
// stored) can be drawn on the ICAO form again: the faxed form (src/pdf/main.tsx) is exactly the
// message that was filed. Free text in the message never holds '-' (cleanText), so '-' splits items.
import { type FplFields, type Item19, parseItem18 } from './fpl';

const NONE19: Item19 = {
  endurance: '',
  persons: '',
  radio: { uhf: false, vhf: false, elt: false },
  survival: { present: false, polar: false, desert: false, maritime: false, jungle: false },
  jackets: { present: false, light: false, fluorescein: false, uhf: false, vhf: false },
  dinghies: null,
  colours: '',
  remarks: '',
  pic: '',
  text: '',
};

/** Item 19 'E/0400 P/002 R/VE S/M J/LF D/01 004 C ORANGE A/WHITE N/… C/ZINDROS D +30 69…'. */
export function parseItem19(s: string): Item19 {
  const text = s.trim();
  const parts: Record<string, string> = {};
  const re = /(?:^|\s)([EPRSJDANC])\//g;
  const marks: { k: string; start: number; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) marks.push({ k: m[1], start: m.index, end: re.lastIndex });
  marks.forEach((k, i) => {
    parts[k.k] = text.slice(k.end, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
  });
  const has = (v: string | undefined, c: string) => !!v && v.includes(c);
  const sv = parts.S;
  const j = parts.J;
  const d = parts.D ? parts.D.split(' ') : null;
  return {
    ...NONE19,
    endurance: parts.E ?? '',
    persons: parts.P ?? '',
    // R/ lists the radios carried; without R/ none is declared
    radio: { uhf: has(parts.R, 'U'), vhf: has(parts.R, 'V'), elt: has(parts.R, 'E') },
    survival: {
      present: !!sv,
      polar: has(sv, 'P'),
      desert: has(sv, 'D'),
      maritime: has(sv, 'M'),
      jungle: has(sv, 'J'),
    },
    jackets: {
      present: !!j || /\bLIFE JACKETS\b/.test(parts.N ?? ''),
      light: has(j, 'L'),
      fluorescein: has(j, 'F'),
      uhf: has(j, 'U'),
      vhf: has(j, 'V'),
    },
    dinghies: d
      ? {
          number: d[0] ?? '',
          capacity: d[1] ?? '',
          covered: d[2] === 'C',
          colour: d.slice(d[2] === 'C' ? 3 : 2).join(' '),
        }
      : null,
    colours: parts.A ?? '',
    remarks: parts.N ?? '',
    pic: parts.C ?? '',
    text,
  };
}

/** The fields of '(FPL-…)' as the form shows them; missing items stay empty. */
export function parseFplMessage(message: string): FplFields {
  const body = message.replace(/\s+/g, ' ').trim().replace(/^\(/, '').replace(/\)$/, '');
  // items start with '-'; a wrapped line's continuation does not
  const items = body.split(/\s?-/).map((s) => s.trim());
  const [, item7 = '', i8 = '', i9 = '', i10 = '', i13 = '', i15 = '', i16 = '', i18 = '', ...rest] = items;
  const i9m = /^(\d{0,2})([A-Z0-9]{2,4})\/([A-Z])$/.exec(i9);
  const [a10 = '', b10 = ''] = i10.split('/');
  const i15m = /^([NKM]\d{3,4})(VFR|[AFSM]\d{3,4})\s*(.*)$/.exec(i15);
  const [i16head = '', ...altn] = i16.split(' ');
  const item18 = i18 || '0';
  return {
    item7,
    item8: { rules: i8.slice(0, 1), type: i8.slice(1, 2) },
    item9: { number: i9m?.[1] ?? '', type: i9m?.[2] ?? i9, wake: i9m?.[3] ?? '' },
    item10: { a: a10, b: b10 },
    item13: { adep: i13.slice(0, 4), eobt: i13.slice(4, 8) },
    item15: { speed: i15m?.[1] ?? '', level: i15m?.[2] ?? '', route: i15m?.[3] ?? i15 },
    item16: { ades: i16head.slice(0, 4), eet: i16head.slice(4, 8), altn1: altn[0] ?? '', altn2: altn[1] ?? '' },
    item18,
    item18Parts: parseItem18(item18),
    item19: rest.length ? parseItem19(rest.join('-')) : NONE19,
  };
}

// The ICAO ATS messages (Doc 4444 Appendix 3) a faxed plan's delay and cancellation carry, built from
// the plan as filed: what an AFTN service would have sent for it.
//   DLA  (DLA-<item 7>-<item 13 with the NEW EOBT>-<item 16 ADES>-DOF/<date>)
//   CNL  (CNL-<item 7>-<item 13>-<item 16 ADES>-DOF/<date>)
// DOF is the date of the (new) EOBT, as item 18 of a delayed plan would say.

interface Head {
  ident: string;
  adep: string;
  eobt: string;
  ades: string;
  dof: string;
}

function head(fpl: string): Head {
  const items = fpl
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\(/, '')
    .replace(/\)$/, '')
    .split(/\s?-/)
    .map((s) => s.trim());
  return {
    ident: items[1] ?? '',
    adep: (items[5] ?? '').slice(0, 4),
    eobt: (items[5] ?? '').slice(4, 8),
    ades: (items[7] ?? '').slice(0, 4),
    dof: /\bDOF\/(\d{6})\b/.exec(items[8] ?? '')?.[1] ?? '',
  };
}

const two = (n: number) => String(n).padStart(2, '0');
const hhmmZ = (ms: number) => `${two(new Date(ms).getUTCHours())}${two(new Date(ms).getUTCMinutes())}`;
const dofOf = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getUTCFullYear() % 100)}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}`;
};

export function dlaMessage(fpl: string, newEobt: number): string {
  const h = head(fpl);
  return `(DLA-${h.ident}-${h.adep}${hhmmZ(newEobt)}-${h.ades}-DOF/${dofOf(newEobt)})`;
}

export function cnlMessage(fpl: string, eobt: number | null): string {
  const h = head(fpl);
  const time = eobt != null ? hhmmZ(eobt) : h.eobt;
  const dof = eobt != null ? dofOf(eobt) : h.dof;
  return `(CNL-${h.ident}-${h.adep}${time}-${h.ades}${dof ? `-DOF/${dof}` : ''})`;
}

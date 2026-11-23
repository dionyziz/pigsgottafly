// Links to the AIP Greece PDFs (src/data/aipLinks.ts, src/data/ref/aip-files.json from tools/aip_files.ts).
import { describe, expect, test } from 'vitest';

import { aipRefParts } from '../../../src/app/AipLink';
import { AIP_EAIP_BASE, AIP_EAIP_INDEX, aipSection, aipUrl, hasAipPdf } from '../../../src/data/aipLinks';
import { AD_AIRSPACES, AERODROMES, AIRAC, AIRSPACES, AREAS } from '../../../src/data/ref';
import { aipFiles } from '../../../tools/aip_files';

describe('AIP links', () => {
  test('the eAIP base is the one of the reference data AIRAC (tools/update_aip.sh sets both)', () => {
    const m = /AMDT (\d\d)\/(\d\d) \(wef (\d+) ([A-Z]{3}) (\d{4})\)/.exec(AIRAC.name)!;
    const wef = `${m[3].padStart(2, '0')}${m[4].toLowerCase()}${m[5]}`;
    expect(AIP_EAIP_BASE).toBe(`https://aisgr.hasp.gov.gr/aipgr_incl_amdt_${m[1]}${m[2]}_wef_${wef}/cd/ais/`);
  });
  test('section of a reference as the app prints them', () => {
    expect(aipSection('AD 2 LGAV')).toBe('AD 2 LGAV');
    expect(aipSection('LGAV AD 2.3')).toBe('AD 2 LGAV');
    expect(aipSection('LGSY AD 2.17')).toBe('AD 2 LGSY');
    expect(aipSection('AD 1.6.12.3')).toBe('AD 1.6.12');
    expect(aipSection('AD 1.6.5')).toBe('AD 1.6.5');
    expect(aipSection('ENR 2.1.3, ENR 2.1.4')).toBe('ENR 2.1');
    expect(aipSection('ENR 5.1')).toBe('ENR 5.1');
    expect(aipSection('GEN 2.7')).toBe('GEN 2.7');
    expect(aipSection('AIP SUP 09/24')).toBe('AIP SUP 09/24');
    expect(aipSection('somewhere')).toBeNull();
  });
  test('URLs of the PDFs (spaces encoded), the start page when there is no PDF', () => {
    expect(aipUrl('AD 2 LGAV')).toBe(AIP_EAIP_BASE + 'eaip/pdf/AD%202/AD2-LGAV/LG_AD_2_LGAV_en.pdf');
    expect(aipUrl('AD 1.6.5.3')).toBe(
      AIP_EAIP_BASE + 'eaip/pdf/ad%201/AD%201.6%20CAT%20B%20AERODROMES/catb/LG_AD_1_6_5_LGTT_en.pdf',
    );
    expect(aipUrl('ENR 5.1')).toBe(AIP_EAIP_BASE + 'eaip/pdf/enr%205/LG_ENR_5_1_en.pdf');
    expect(aipUrl('ENR 9.9')).toBe(AIP_EAIP_INDEX);
    expect(hasAipPdf('ENR 9.9')).toBe(false);
  });
  test('every AIP source the map and panels show has its PDF', () => {
    const sources = [
      ...AERODROMES.map((a) => a.source),
      ...AERODROMES.flatMap((a) => (a.hours ? [a.hours.source, a.hours.handling.source] : [])),
      ...AIRSPACES.map((a) => a.source),
      ...AD_AIRSPACES.map((a) => a.source),
      ...AREAS.map((a) => a.source),
    ];
    const missing = [...new Set(sources)].filter((s) => !hasAipPdf(s));
    expect(missing).toEqual([]);
  });
  test('table of contents → sections (main files only, no charts)', () => {
    const html = `<A HREF="eaip/pdf/enr 5/LG_ENR_5_1_en.pdf" target="x">ENR 5.1</A>
      <A HREF="eaip/pdf/AD 2/AD2-LGAV/LG_AD_2_LGAV_en.pdf">x</A><A HREF="eaip/pdf/AD 2/AD2-LGAV/LG_AD_2_LGAV_ADC_en.pdf">x</A>
      <A HREF="eaip/pdf/ad 1/AD 1.6 CAT B AERODROMES/catb/LG_AD_1_6_12_LGKM_en.pdf">x</A>
      <A HREF="eaip/pdf/ad 1/AD 1.6 CAT B AERODROMES/catb/LG_AD_1_6_12_LGKM_ADC_en.pdf">x</A>
      <A HREF="eaip/pdf/ad 3/HELIPORTS/LG_AD_3_13_ATTIKI-ANOIXI_en.pdf ">x</A>`;
    expect(aipFiles(html)).toEqual({
      'AD 1.6.12': 'eaip/pdf/ad 1/AD 1.6 CAT B AERODROMES/catb/LG_AD_1_6_12_LGKM_en.pdf',
      'AD 2 LGAV': 'eaip/pdf/AD 2/AD2-LGAV/LG_AD_2_LGAV_en.pdf',
      'AD 3.13': 'eaip/pdf/ad 3/HELIPORTS/LG_AD_3_13_ATTIKI-ANOIXI_en.pdf',
      'ENR 5.1': 'eaip/pdf/enr 5/LG_ENR_5_1_en.pdf',
    });
  });
  test('supplements menu → AIP SUPs (hrefs relative to esup/)', () => {
    const menu = `<li><span class="file"><A HREF="./SUPS/LG_SUP_A_2023_01_en.pdf" target="eAISNavigation">AIP SUP 01/23</A>
      <li><span class="file"><A HREF="sups/LG_SUP_A_2024_09_en.pdf" target="eAISNavigation">AIP SUP 09/24</A>`;
    expect(aipFiles('', menu)).toEqual({
      'AIP SUP 01/23': 'esup/SUPS/LG_SUP_A_2023_01_en.pdf',
      'AIP SUP 09/24': 'esup/sups/LG_SUP_A_2024_09_en.pdf',
    });
  });
});

describe('AIP references inside texts', () => {
  test('are found, with the aerodrome of an AD 2 reference taken from the text before it', () => {
    expect(aipRefParts('Departure LGTT closed at 16:20Z (12:00–14:00Z): hours HJ (AIP AD 1.6.5.3).')).toEqual([
      { text: 'Departure LGTT closed at 16:20Z (12:00–14:00Z): hours HJ (AIP ' },
      { text: 'AD 1.6.5.3', ref: 'AD 1.6.5.3' },
      { text: ').' },
    ]);
    expect(aipRefParts('LGAV: handling H24 (AIP AD 2.3)').filter((p) => p.ref)).toEqual([
      { text: 'AD 2.3', ref: 'LGAV AD 2.3' },
    ]);
    expect(
      aipRefParts('see LGAV AD 2.17 and ENR 2.1')
        .filter((p) => p.ref)
        .map((p) => p.ref),
    ).toEqual(['LGAV AD 2.17', 'ENR 2.1']);
    expect(aipRefParts('no reference here')).toEqual([{ text: 'no reference here' }]);
  });
});

// MD 4.3 loading sheet (page 1), then the MD 4.4 performance log: one page per sector (each take-off →
// landing), each page signed by the PIC. The operator's PDF is printed from the same WbPerfContent
// (./declaration.ts) with these same sheets (src/pdf/, api/_lib/sheetPdf.ts).
import '../wb/xp.css';

import type { Flight } from '../../../shared';
import { Chip, type ChipTone, Loading, Panel } from '../../../ui';
import { routeText } from '../form731/common';
import type { ShownSignature } from '../form731/Form731';
import { perfSheetModel } from '../performance/model';
import { blockName, PerfSheet } from '../performance/PerformanceExport';
import { ExportWarnings } from '../WarningList';
import { wbSheetModel } from '../wb/model';
import { useExportCalc } from '../wb/useExportCalc';
import { WbSheet } from '../wb/WbExport';
import { wbPerfContent } from './declaration';
import { OperatorSendPanel } from './SendPanel';

const chipTone = (v: string): ChipTone => (v === 'pass' ? 'ok' : v === 'fail' ? 'danger' : 'warn');

export function WbPerfExport({ flight }: { flight: Flight }) {
  const st = useExportCalc(flight);
  if (st.loading || !st.calc) return <Loading />;
  const wb = wbSheetModel({
    doc: flight,
    aircraft: st.aircraft,
    pilot: st.pilot,
    calc: st.calc,
    route: routeText(flight.route),
  });
  const perf = perfSheetModel({ doc: flight, aircraft: st.aircraft, pilot: st.pilot, calc: st.calc });
  // the sheets as drawn here and as sent to the operator (printed from the same content)
  const content = wbPerfContent(wb, perf);
  const signer = st.pilot.fullName.trim() || wb.pilot.trim();
  const signature: ShownSignature | null = signer ? { name: signer, signedAt: st.nowMs } : null;
  const legs = st.calc.computed.navlog.legs.length;
  const windsOk = st.weather?.status === 'ok';
  const anyWx = !!(
    st.calc.departure.conditions ||
    st.calc.arrival.conditions ||
    st.calc.stops.some((x) => x.landing.conditions || x.takeoff.conditions)
  );
  const perfWarnings = [
    ...perf.warnings,
    ...perf.pages
      .flatMap((pg) => [pg.takeoff, pg.landing])
      .filter((b, i, all) => all.indexOf(b) === i)
      .flatMap((b) => b.warnings.map((w) => `${blockName(b)}: ${w}`)),
  ];
  const warnings = [...wb.warnings.map((w) => `W&B: ${w}`), ...perfWarnings.map((w) => `Performance: ${w}`)];
  return (
    <div
      className="xp-doc print-sheet-page"
      data-testid="wbperf-export"
      data-ready={st.weatherPending ? 'false' : 'true'}
      data-wb-verdict={wb.verdict}
      data-perf-verdict={perf.verdict}
      data-pages={1 + perf.pages.length}
    >
      <Panel
        title="Checks"
        className="xp-status"
        status={
          <>
            <Chip tone={chipTone(wb.verdict)} testId="wb-status">
              W&amp;B: {wb.verdictText}
            </Chip>
            <Chip tone={chipTone(perf.verdict)} testId="performance-status">
              Performance: {perf.verdictText}
            </Chip>
            {legs > 0 && (
              <Chip tone={st.weatherPending ? undefined : windsOk ? 'ok' : 'warn'}>
                {st.weatherPending
                  ? 'Loading winds…'
                  : windsOk
                    ? 'Trip fuel with forecast winds'
                    : 'Trip fuel without winds (calm)'}
              </Chip>
            )}
            {!st.weatherPending && (
              <Chip tone={anyWx ? 'ok' : 'warn'}>
                {anyWx ? 'Surface weather loaded' : 'No surface weather: ISA and calm'}
              </Chip>
            )}
          </>
        }
        actions={
          <button className="ghost" onClick={st.refresh} disabled={st.weatherPending}>
            Refresh weather
          </button>
        }
      >
        <ExportWarnings warnings={warnings} aircraftId={flight.aircraftId} testId="wbperf-warnings" />
      </Panel>
      <OperatorSendPanel flightId={flight.id} content={st.weatherPending ? null : content} />
      <div className="xp-stage">
        <WbSheet c={content} signature={signature} />
        {content.perf.pages.map((_, i) => (
          <PerfSheet key={i} c={content} pageNo={i + 1} signature={signature} />
        ))}
      </div>
    </div>
  );
}

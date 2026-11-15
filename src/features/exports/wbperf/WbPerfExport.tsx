// Export "Weight & balance and performance": one document, the club's MD 4.3 loading sheet (page 1)
// followed by the MD 4.4 performance log (one page per sector: a flight with intermediate full
// stops gets a page for each take-off → landing), each page signed by the PIC on its SIGN line.
// The signature is the PIC's e-signature (the handwriting signature of Form 731 and the General
// Declaration) dated when these sheets were computed.
//
// Usage (ExportPage): <WbPerfExport flight={flight} />. Loads the pilot, the aircraft and the
// weather (winds aloft for trip fuel; surface forecast / METAR at take-off and landing) itself.
import type { Flight } from '../../../shared';
import { routeText } from '../form731/common';
import type { ShownSignature } from '../form731/Form731';
import { useExportCalc } from '../wb/useExportCalc';
import { wbSheetModel } from '../wb/model';
import { WbSheet } from '../wb/WbExport';
import { perfSheetModel } from '../performance/model';
import { PerfSheet, blockName } from '../performance/PerformanceExport';
import { WarningList } from '../WarningList';
import '../wb/xp.css';

const chipTone = (v: string) => (v === 'pass' ? 'ok' : v === 'fail' ? 'danger' : 'warn');

export function WbPerfExport({ flight }: { flight: Flight }) {
  const st = useExportCalc(flight);
  if (st.loading || !st.calc) return <div className="xp-loading muted">Loading…</div>;
  const wb = wbSheetModel({ doc: flight, aircraft: st.aircraft, pilot: st.pilot, calc: st.calc, route: routeText(flight.route) });
  const perf = perfSheetModel({ doc: flight, aircraft: st.aircraft, pilot: st.pilot, calc: st.calc });
  const signer = (st.pilot?.fullName ?? '').trim() || wb.pilot.trim();
  const signature: ShownSignature | null = signer ? { name: signer, signedAt: st.nowMs } : null;
  const legs = st.calc.computed.navlog.legs.length;
  const windsOk = st.weather?.status === 'ok';
  const anyWx = !!(st.calc.departure.conditions || st.calc.arrival.conditions || st.calc.stops.some((x) => x.landing.conditions || x.takeoff.conditions));
  const perfWarnings = [...perf.warnings, ...perf.pages.flatMap((pg) => [pg.takeoff, pg.landing])
    .filter((b, i, all) => all.indexOf(b) === i)
    .flatMap((b) => b.warnings.map((w) => `${blockName(b)}: ${w}`))];
  const warnings = [...wb.warnings.map((w) => `W&B: ${w}`), ...perfWarnings.map((w) => `Performance: ${w}`)];
  return (
    <div className="xp-doc" data-testid="wbperf-export" data-ready={st.weatherPending ? 'false' : 'true'}
      data-wb-verdict={wb.verdict} data-perf-verdict={perf.verdict} data-pages={1 + perf.pages.length}>
      <div className="xp-status no-print">
        <div className="xp-status-row">
          <span className={`chip ${chipTone(wb.verdict)}`} data-testid="wb-status">W&amp;B: {wb.verdictText}</span>
          <span className={`chip ${chipTone(perf.verdict)}`} data-testid="performance-status">Performance: {perf.verdictText}</span>
          {legs > 0 && (
            <span className={`chip ${st.weatherPending ? '' : windsOk ? 'ok' : 'warn'}`}>
              {st.weatherPending ? 'Loading winds…' : windsOk ? 'Trip fuel with forecast winds' : 'Trip fuel without winds (calm)'}
            </span>
          )}
          {!st.weatherPending && <span className={`chip ${anyWx ? 'ok' : 'warn'}`}>{anyWx ? 'Surface weather loaded' : 'No surface weather: ISA and calm'}</span>}
          <span className="spacer" />
          <button className="ghost" onClick={st.refresh} disabled={st.weatherPending}>Refresh weather</button>
        </div>
        <WarningList warnings={warnings} aircraftId={flight.aircraftId} className="xp-warnings" testId="wbperf-warnings" />
      </div>
      <div className="xp-stage">
        <WbSheet m={wb} signature={signature} />
        {perf.pages.map((pg, i) => <PerfSheet key={i} m={perf} page={pg} pageNo={i + 1} signature={signature} />)}
      </div>
    </div>
  );
}

import { Fragment } from 'react';

import { AipLink, VfrChartLinks } from '../../../app/AipLink';
import type { RefNavaid } from '../../../shared/ref';
import { fmtHemi, NAVAID_TYPE_NAME, navaidFreqText } from './features';
import { PopItem } from './MapPopover';
import type { VfrChart } from './vfrCharts';

function Head({ n, tip }: { n: RefNavaid; tip?: boolean }) {
  return (
    <>
      <b className="pgf-air-type t-nav">{n.type}</b>
      <span className={tip ? 'pgf-air-tip-name' : 'pgf-air-name'}>
        {n.ident} · {n.name}
      </span>
      <span className={tip ? 'pgf-air-tip-lim' : 'pgf-air-lim'}>{navaidFreqText(n)}</span>
    </>
  );
}

export function NavaidTipRows({ n }: { n: RefNavaid }) {
  return (
    <div className="pgf-tip-section" data-testid="navaid-tip">
      <div className="pgf-air-tip-row">
        <Head n={n} tip />
      </div>
    </div>
  );
}

export function NavaidDetails({ n, airac, charts = [] }: { n: RefNavaid; airac: string; charts?: VfrChart[] }) {
  return (
    <section className="pgf-pop-section" aria-label="Radio navaid" data-testid="navaid-pop">
      <PopItem open head={<Head n={n} />}>
        <dl className="pgf-air-body" data-testid="navaid-detail">
          <dt>Type</dt>
          <dd>{NAVAID_TYPE_NAME[n.type]}</dd>
          <dt>Frequency</dt>
          <dd>
            {n.freq !== null && `${navaidFreqText(n)}`}
            {n.freq !== null && n.channel && ' · '}
            {n.channel && `CH ${n.channel}`}
          </dd>
          <dt>Hours</dt>
          <dd>{n.hours}</dd>
          {n.coverage && (
            <>
              <dt>Coverage</dt>
              <dd>{n.coverage}</dd>
            </>
          )}
          {n.elevFt !== null && (
            <>
              <dt>DME elev</dt>
              <dd>{n.elevFt} ft</dd>
            </>
          )}
          {(n.variation !== null || n.declination !== null) && (
            <>
              <dt>Variation</dt>
              <dd>
                {n.variation !== null && `${fmtHemi(n.variation)} (${n.variationYear})`}
                {n.declination !== null && `${n.variation !== null ? ' · ' : ''}declination ${fmtHemi(n.declination)}`}
              </dd>
            </>
          )}
        </dl>
        <div className="pgf-air-text pgf-ad-src">
          {n.sources.map((s, i) => (
            <Fragment key={s}>
              {i > 0 && ', '}
              <AipLink refText={s}>AIP Greece {s}</AipLink>
            </Fragment>
          ))}
          {charts.length > 0 && (
            <>
              {' · '}
              <VfrChartLinks charts={charts} />
            </>
          )}{' '}
          <span className="muted">· AIRAC {airac}</span>
        </div>
      </PopItem>
    </section>
  );
}

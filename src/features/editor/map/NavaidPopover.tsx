// Radio navaid hover tooltip and click popover on the route map: type, ident, name and frequency on
// hover; on click also the channel, hours, coverage, DME elevation, variation / declination and links to
// the AIP sections that publish it (ENR 4.1, the aerodromes' AD 2.19).
import { Fragment } from 'react';

import { AipLink } from '../../../app/AipLink';
import type { RefNavaid } from '../../../shared/ref';
import { navaidFreq } from './features';
import { MapPopover, MapTip, PopItem } from './MapPopover';

const TYPE_NAME: Record<RefNavaid['type'], string> = {
  VOR: 'VOR',
  'VOR/DME': 'VOR/DME',
  VORTAC: 'VORTAC',
  TACAN: 'TACAN',
  DME: 'DME',
  NDB: 'NDB',
  'NDB/DME': 'NDB/DME',
  L: 'Locator (L)',
};

/** '114.40 MHz', '382 kHz', 'CH 91X'. */
export function navaidFreqText(n: RefNavaid): string {
  const f = navaidFreq(n);
  return n.freq === null ? f : `${f} ${n.unit}`;
}

const hemi = (deg: number) => `${Math.abs(deg)}°${deg < 0 ? 'W' : 'E'}`;

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

export function NavaidTip({ x, y, n }: { x: number; y: number; n: RefNavaid }) {
  return (
    <MapTip x={x} y={y} testId="navaid-tip">
      <div className="pgf-air-tip-row">
        <Head n={n} tip />
      </div>
    </MapTip>
  );
}

export function NavaidPopover({
  x,
  y,
  n,
  airac,
  onClose,
}: {
  x: number;
  y: number;
  n: RefNavaid;
  airac: string;
  onClose: () => void;
}) {
  return (
    <MapPopover x={x} y={y} label="Radio navaid" testId="navaid-pop" onClose={onClose}>
      <PopItem open head={<Head n={n} />}>
        <dl className="pgf-air-body" data-testid="navaid-detail">
          <dt>Type</dt>
          <dd>{TYPE_NAME[n.type]}</dd>
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
                {n.variation !== null && `${hemi(n.variation)} (${n.variationYear})`}
                {n.declination !== null && `${n.variation !== null ? ' · ' : ''}declination ${hemi(n.declination)}`}
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
          ))}{' '}
          <span className="muted">· AIRAC {airac}</span>
        </div>
      </PopItem>
    </MapPopover>
  );
}

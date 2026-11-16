// /about: where the data comes from. The weather model and the data sources are named here only;
// the rest of the app shows the data without its provenance (e.g. the navlog strip shows "06Z run").
/* eslint-disable @eslint-react/no-missing-key -- the rows are [label, value] tuples, not rendered lists */
import './about.css';

import type { ReactNode } from 'react';

import { AIP_EAIP_INDEX } from '../data/aipLinks';
import { AIRAC } from '../data/ref';
import { CardSection } from '../ui';
import { Shell } from './Shell';

/** The forecast model behind winds aloft, surface forecasts and the weather hazards. */
export const WEATHER_MODEL = 'ECMWF IFS 0.25°';

const ext = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
);

/** 'AIRAC AMDT 09/26' from the id '2609'. */
const airacName = (id: string) => (/^\d{4}$/.test(id) ? `AIRAC AMDT ${id.slice(2)}/${id.slice(0, 2)}` : `AIRAC ${id}`);

function Rows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="about-list">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AboutPage() {
  return (
    <Shell>
      <div className="page-head">
        <h1>About</h1>
      </div>
      <div className="card about" data-testid="about">
        <CardSection id="aeronautical" title="Aeronautical data" plain>
          <Rows
            rows={[
              [
                'AIP',
                <>
                  {ext(AIP_EAIP_INDEX, 'AIP Greece (HASP eAIP)')}, {airacName(AIRAC.id)}, effective {AIRAC.effective}
                </>,
              ],
              [
                'Contents',
                'Aerodromes, runways, operational hours, airspace, ENR 5 areas, VFR points and routes, ATC units, sunset tables (GEN 2.7)',
              ],
              ['NOTAMs', <>{ext('https://www.autorouter.aero', 'autorouter')} (EUROCONTROL EAD)</>],
              ['Flight plans', <>Filed through {ext('https://www.autorouter.aero', 'autorouter')}</>],
            ]}
          />
        </CardSection>
        <CardSection id="weather" title="Weather" plain>
          <Rows
            rows={[
              ['Model', <span data-testid="about-weather-model">{WEATHER_MODEL}</span>],
              [
                'Forecast',
                <>
                  {ext('https://open-meteo.com', 'Open-Meteo')}: winds and temperatures aloft, surface wind, temperature
                  and QNH, cloud, visibility, thunderstorms
                </>,
              ],
              ['METAR, TAF', ext('https://aviationweather.gov', 'aviationweather.gov')],
            ]}
          />
        </CardSection>
        <CardSection id="models" title="Models" plain>
          <Rows
            rows={[
              ['Magnetic variation', 'World Magnetic Model WMM2025'],
              ['Sunset', 'AIP GEN 2.7 tables, else the NOAA solar calculation'],
            ]}
          />
        </CardSection>
        <CardSection id="rules" title="Planning rules" plain>
          <Rows
            rows={[
              [
                'Leg altitudes',
                'Charted VFR route, else the closest charted route (custom points), else the previous leg; pattern altitude on the first and last legs and at stops; clear an altitude to go back to it',
              ],
              [
                'Speeds',
                'Pattern TAS on the first and last legs, cruise TAS elsewhere; calm wind where there is no forecast',
              ],
              ['Compass', 'Deviation = steer − for; no card: compass heading = magnetic heading'],
              [
                'Fuel',
                'Fixed allowance once per flight, plus once per stop; a total fuel on board is the default fuel',
              ],
              ['W&B', 'Unusable fuel at the fuel arm unless in the empty mass; empty max landing mass = MTOW'],
              ['Performance', 'Corrected distance × safety factor; slope factor per 2 % adverse slope'],
              [
                'Flight plan',
                'Item 7 without the hyphen; the operator as OPR/; aircraft RMK/ joins the flight’s RMK/; DOF/, REG/, DEP/, DEST/, ALTN/, EET/ from the flight',
              ],
              ['Operator sheets', 'W&B and performance as PDF, you in copy; replies go to you'],
              ['Signing links', 'Shown once; “New link” replaces a lost one'],
            ]}
          />
        </CardSection>
        <CardSection id="maps" title="Maps" plain>
          <Rows
            rows={[
              [
                'Base maps',
                <>
                  {ext('https://openfreemap.org', 'OpenFreeMap')},{' '}
                  {ext('https://www.openstreetmap.org/copyright', 'OpenStreetMap')},{' '}
                  {ext('https://opentopomap.org', 'OpenTopoMap')}
                </>,
              ],
              ['Aero overlay', ext('https://www.openflightmaps.org', 'open flightmaps')],
            ]}
          />
        </CardSection>
      </div>
    </Shell>
  );
}

// /about/licenses: the third-party software, fonts and data with their license texts, from
// src/data/licenses.json (npm run licenses). Its own chunk: the texts are ~160 KB nobody else needs.
import './about.css';

import { Link } from 'react-router';

import licensesJson from '../data/licenses.json';
import { CardSection } from '../ui';
import { Shell } from './Shell';

interface LicenseEntry {
  group: 'Software' | 'Fonts' | 'Data';
  name: string;
  version?: string;
  license: string;
  copyright?: string;
  url?: string;
  text: string;
}

const licenses = licensesJson as { entries: LicenseEntry[]; texts: Record<string, string> };

const GROUPS: [LicenseEntry['group'], string][] = [
  ['Software', 'Software'],
  ['Fonts', 'Fonts'],
  ['Data', 'Map, terrain and weather data'],
];

export function LicensesPage() {
  return (
    <Shell>
      <div className="page-head">
        <h1>Open-source licenses</h1>
        <span className="spacer" />
        <Link to="/about">About</Link>
      </div>
      <div className="card about" data-testid="licenses">
        {GROUPS.map(([group, title]) => (
          <CardSection key={group} id={`licenses-${group.toLowerCase()}`} title={title} plain>
            <ul className="license-list">
              {licenses.entries
                .filter((e) => e.group === group)
                .map((e) => (
                  <li key={`${e.name}@${e.version ?? ''}`} data-testid="license">
                    <details>
                      <summary>
                        <b>{e.name}</b>
                        {e.version && <span className="license-version">{e.version}</span>}
                        <span className="license-id">{e.license}</span>
                      </summary>
                      {e.copyright && <p className="license-copyright">{e.copyright}</p>}
                      {e.url && (
                        <p>
                          <a href={e.url} target="_blank" rel="noopener noreferrer">
                            {e.url}
                          </a>
                        </p>
                      )}
                      <pre className="license-text">{licenses.texts[e.text]}</pre>
                    </details>
                  </li>
                ))}
            </ul>
          </CardSection>
        ))}
      </div>
    </Shell>
  );
}

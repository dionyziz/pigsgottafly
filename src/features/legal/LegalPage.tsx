// Layout of the public legal pages (/privacy, /terms): no sign-in, no Shell (the Shell needs a
// session). A top bar back to the app, the document in one card, links to the other document.
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import './legal.css';

export const LEGAL_UPDATED = '16 November 2026';
export const CONTACT_EMAIL = 'dionyziz@gmail.com';

export interface LegalSection { id: string; title: string; body: ReactNode }

export function LegalPage({ title, lead, sections, current }: { title: string; lead: ReactNode; sections: LegalSection[]; current: 'privacy' | 'terms' }) {
  useEffect(() => {
    const prev = document.title;
    document.title = `${title} · Pig's Gotta Fly`;
    // a #section link opens at that section once it is rendered
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    return () => { document.title = prev; };
  }, [title]);
  return (
    <div className="legal-page" data-testid={`legal-${current}`}>
      <header className="legal-top">
        <Link to="/" className="legal-home"><img src="/icon.svg" alt="" />Pig's Gotta Fly</Link>
        <span className="spacer" />
        <nav>
          <Link to="/terms" aria-current={current === 'terms' ? 'page' : undefined}>Terms of Service</Link>
          <Link to="/privacy" aria-current={current === 'privacy' ? 'page' : undefined}>Privacy Policy</Link>
        </nav>
      </header>
      <main className="legal-doc card">
        <h1>{title}</h1>
        <p className="legal-date">Last updated {LEGAL_UPDATED}</p>
        <div className="legal-lead">{lead}</div>
        <nav className="legal-toc" aria-label="Contents">
          <b>Contents</b>
          <ol>{sections.map((s) => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}</ol>
        </nav>
        {sections.map((s, i) => (
          <section key={s.id} aria-labelledby={s.id}>
            <h2 id={s.id}>{i + 1}. {s.title}</h2>
            {s.body}
          </section>
        ))}
      </main>
      <footer className="legal-foot">
        <span>Pig's Gotta Fly · operated by Dionysis Zindros, Greece</span>
        <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
        {current === 'privacy' ? <Link to="/terms">Terms of Service</Link> : <Link to="/privacy">Privacy Policy</Link>}
      </footer>
    </div>
  );
}

export const Mail = () => <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;

// Page chrome for the lobby and the account pages: brand, optional centre content, account menu.
// The flight editor and the export pages have their own full-window layouts.
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { AccountMenu } from './AccountMenu';

export function TopBar({ children }: { children?: ReactNode }) {
  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <img src="/icon.svg" alt="" />
        <span>Pig's Gotta Fly</span>
      </Link>
      <div className="topbar-mid">{children}</div>
      <AccountMenu />
    </header>
  );
}

export function Shell({ children, top }: { children: ReactNode; top?: ReactNode }) {
  return (
    <>
      <TopBar>{top}</TopBar>
      <main className="page">{children}</main>
    </>
  );
}

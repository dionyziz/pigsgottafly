// Page sections: CardSection (a titled section of a form page: the aircraft page, the profile) and
// Panel (a screen-only panel above an export sheet: filing, signatures, sending).
import type { ReactNode } from 'react';

/**
 * A titled section with an anchor id. A card by itself, or `plain` for sections that share one card
 * (separated by a line).
 */
export function CardSection({
  id,
  title,
  intro,
  actions,
  children,
  plain,
  className,
  testId,
}: {
  id: string;
  title: ReactNode;
  intro?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  plain?: boolean;
  className?: string;
  testId?: string;
}) {
  const cls = ['card-section', plain ? 'plain' : 'card', className].filter(Boolean).join(' ');
  return (
    <section className={cls} id={id} aria-labelledby={id + '-h'} data-testid={testId}>
      <header>
        <div>
          <h2 id={id + '-h'}>{title}</h2>
          {intro && <p>{intro}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

/** Screen-only panel with a title, a status (chip) and actions on the right. */
export function Panel({
  title,
  status,
  actions,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={'panel no-print' + (className ? ' ' + className : '')} data-testid={testId}>
      <div className="panel-head">
        <h3>{title}</h3>
        {status}
        <span className="spacer" />
        {actions}
      </div>
      {children}
    </div>
  );
}

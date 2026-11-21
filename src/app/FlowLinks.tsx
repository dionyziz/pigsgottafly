// The links of out and back (back.ts): FlowLink leaves a flight page with ?back=; FlowBack, at the top
// of the page it opens, returns.
import { Link, type LinkProps } from 'react-router';

import { Icon } from '../ui';
import { backLabel, useBack, useWithBack } from './back';

/** A link out of a flight page: the page it opens offers the way back. */
export function FlowLink({ to, ...rest }: Omit<LinkProps, 'to'> & { to: string }) {
  const withBack = useWithBack();
  return <Link {...rest} to={withBack(to)} />;
}

/** "← Back to Form 731", when this page was opened from one (?back=). */
export function FlowBack() {
  const { back } = useBack();
  if (!back) return null;
  return (
    <Link to={back} replace className="flow-back no-print" data-testid="flow-back">
      <Icon name="back" size={14} />
      {backLabel(back)}
    </Link>
  );
}

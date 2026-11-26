// The paywall: any 402 from the API (an expired pilot tried to plan, brief or file) opens this dialog, and
// pages in the Shell show a banner in the trial's last week and after it ends. Nothing shows while the
// subscription is not enforced (SessionResponse.billingEnforced).
import './billing.css';

import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { useSession } from '../../app/session';
import { Dialog, DialogFooter } from '../../ui';
import { entitlementText, useBilling } from './useBilling';

const WARN_MS = 7 * 24 * 3600e3;

export function Paywall() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('pgf:subscription-required', show);
    return () => window.removeEventListener('pgf:subscription-required', show);
  }, []);
  return open ? <PaywallDialog onClose={() => setOpen(false)} /> : null;
}

function PaywallDialog({ onClose }: { onClose: () => void }) {
  const { session } = useSession();
  const { billing, busy, waiting, error, subscribe } = useBilling();
  const active = !!session.entitlement?.active;
  useEffect(() => {
    if (active && !waiting) onClose();
  }, [active, waiting, onClose]);
  return (
    <Dialog
      title="Subscribe to keep planning"
      onClose={onClose}
      busy={busy}
      testId="paywall"
      footer={
        <DialogFooter
          error={error}
          status={waiting ? 'Confirming your payment…' : undefined}
          onCancel={onClose}
          cancelLabel="Not now"
          busy={busy || waiting}
          primary={{
            label: billing ? `Subscribe, ${billing.price}` : 'Subscribe',
            onClick: () => void subscribe(),
            disabled: !billing?.paddle,
            testId: 'paywall-subscribe',
          }}
        />
      }
    >
      <p>{session.entitlement ? entitlementText(session.entitlement) : ''}</p>
      <p>
        One subscription covers planning, briefing, filing and the iPhone and iPad app. Your flights, hangar and
        passengers stay yours to read, export or delete either way.
      </p>
    </Dialog>
  );
}

/** Above a Shell page: the trial's last week, or after it ended. */
export function BillingBanner() {
  const { session } = useSession();
  const { pathname } = useLocation();
  const [now] = useState(() => Date.now());
  const e = session.entitlement;
  if (!session.billingEnforced || !e || pathname === '/subscription') return null;
  const soon = e.reason === 'trial' && e.until! - now < WARN_MS;
  if (!soon && e.active) return null;
  return (
    <div className={`billing-banner${e.active ? '' : ' expired'}`} data-testid="billing-banner">
      <span>{entitlementText(e)}</span>
      <Link to="/subscription" className="btn primary">
        Subscribe
      </Link>
    </div>
  );
}

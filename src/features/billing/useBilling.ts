// The subscription as the website shows it: status text, buying through Stripe's hosted Checkout (it comes back
// to /subscription?checkout=done), and managing it in Stripe's customer portal.
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { useSession } from '../../app/session';
import { api } from '../../data/api';
import type { BillingResponse, Entitlement } from '../../shared';
import { errorMessage } from '../../shared/format';

const DAY = 24 * 3600e3;
const day = (ms: number) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function entitlementText(e: Entitlement, now = Date.now()): string {
  switch (e.reason) {
    case 'founder':
      return 'Founding pilot: everything is free for life.';
    case 'paid':
      return e.renews
        ? `Subscribed. Renews on ${day(e.until!)}.`
        : `Subscribed until ${day(e.until!)}. It will not renew.`;
    case 'granted':
      return `Free until ${day(e.until!)}.`;
    case 'trial': {
      const left = Math.max(1, Math.ceil((e.until! - now) / DAY));
      return `Free trial: ${left} day${left === 1 ? '' : 's'} left (until ${day(e.until!)}).`;
    }
    case 'expired':
      return 'Your free trial or subscription has ended. Your flights and hangar stay here to read.';
  }
}

/** Stripe's webhook reaches the server a few seconds after the checkout: ask until it has. */
const POLL_MS = 2000;
const POLL_FOR_MS = 90e3;

export function useBilling() {
  const { setEntitlement } = useSession();
  const [params, setParams] = useSearchParams();
  const returned = params.get('checkout') === 'done';
  const [billing, setBilling] = useState<BillingResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const b = await api.billing.get();
    setBilling(b);
    setEntitlement(b.entitlement);
    return b;
  }, [setEntitlement]);
  useEffect(() => {
    refresh().catch((e) => setError(errorMessage(e)));
  }, [refresh]);

  useEffect(() => {
    if (!returned) return;
    setParams((p) => (p.delete('checkout'), p), { replace: true });
    setWaiting(true);
    const until = Date.now() + POLL_FOR_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const b = await refresh().catch(() => null);
      if (b?.entitlement.reason === 'paid' || b?.entitlement.reason === 'founder') return setWaiting(false);
      if (Date.now() < until) timer = setTimeout(() => void tick(), POLL_MS);
      else {
        setWaiting(false);
        setError('The payment went through, but the subscription has not reached us yet. Reload in a minute.');
      }
    };
    void tick();
    return () => clearTimeout(timer);
  }, [returned, refresh, setParams]);

  const subscribe = async () => {
    setError(null);
    setBusy(true);
    try {
      window.location.assign((await api.billing.checkout()).url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const manage = async () => {
    setError(null);
    setBusy(true);
    try {
      window.location.assign((await api.billing.portal()).url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return { billing, busy, waiting, error, subscribe, manage };
}

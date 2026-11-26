// /subscription: the pilot's subscription, with Subscribe (Paddle's checkout) or Manage (Paddle's customer
// portal: cancel, card, invoices). One bought in the iOS app is managed in the App Store.
import './billing.css';

import { Link } from 'react-router';

import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { CardSection, Loading } from '../../ui';
import { entitlementText, useBilling } from './useBilling';

export function SubscriptionPage() {
  const { session } = useSession();
  const { billing, busy, waiting, error, subscribe, manage } = useBilling();
  const e = session.entitlement;
  const reason = e?.reason;
  return (
    <Shell>
      <h1>Subscription</h1>
      <div className="card" data-testid="subscription">
        <CardSection id="plan" title="Your plan" plain>
          {!billing || !e ? (
            <Loading />
          ) : (
            <div className="stack">
              <p data-testid="subscription-status">{entitlementText(e)}</p>
              {waiting && <p className="muted">Confirming your payment…</p>}
              {reason === 'paid' && billing.store === 'paddle' && (
                <div>
                  <button onClick={() => void manage()} disabled={busy} data-testid="subscription-manage">
                    Manage subscription
                  </button>
                </div>
              )}
              {reason === 'paid' && billing.store === 'apple' && (
                <p className="muted">
                  Bought in the iPhone or iPad app: manage it in the App Store (Settings → your name → Subscriptions).
                </p>
              )}
              {reason !== 'paid' && reason !== 'founder' && (
                <div>
                  <button
                    className="primary"
                    onClick={() => void subscribe()}
                    disabled={busy || waiting || !billing.paddle}
                    data-testid="subscription-subscribe"
                  >
                    Subscribe, {billing.price}
                  </button>
                </div>
              )}
              {error && <p className="error">{error}</p>}
            </div>
          )}
        </CardSection>
        <CardSection id="what" title="What it covers" plain>
          <p>
            Flight planning, navlog, weight and balance, weather and NOTAM briefings, filing, forms, and the iPhone and
            iPad app with Fly mode. Price includes VAT. Payments on the website are handled by Paddle, our reseller. See
            the <Link to="/terms">Terms of Service</Link>.
          </p>
        </CardSection>
      </div>
    </Shell>
  );
}

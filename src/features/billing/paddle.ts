// Paddle.js v2 (https://developer.paddle.com/paddlejs/overview), loaded only when a pilot opens the checkout.
// The pilot id goes in customData: the webhook (api/_lib/billing/paddle.ts) ties the subscription to it.
import type { BillingResponse } from '../../shared';

interface PaddleJs {
  Environment: { set: (env: 'sandbox') => void };
  Initialize: (o: { token: string; eventCallback?: (e: { name?: string }) => void }) => void;
  Checkout: {
    open: (o: {
      items: { priceId: string; quantity: number }[];
      customer?: { email: string };
      customData?: Record<string, string>;
      settings?: { displayMode?: 'overlay'; theme?: 'light' | 'dark'; allowLogout?: boolean };
    }) => void;
  };
}
declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

const SRC = 'https://cdn.paddle.com/paddle/v2/paddle.js';
let loading: Promise<PaddleJs> | null = null;
let onCompleted: (() => void) | null = null;

function load(cfg: NonNullable<BillingResponse['paddle']>): Promise<PaddleJs> {
  loading ??= new Promise<PaddleJs>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => {
      const P = window.Paddle;
      if (!P) return reject(new Error('the checkout did not load'));
      if (cfg.environment === 'sandbox') P.Environment.set('sandbox');
      // Initialize may run once per page: completions go to whichever checkout is open
      P.Initialize({
        token: cfg.clientToken,
        eventCallback: (e) => {
          if (e.name === 'checkout.completed') onCompleted?.();
        },
      });
      resolve(P);
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('the checkout could not be loaded; check your connection'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function openCheckout(
  billing: BillingResponse,
  pilot: { id: string; email: string },
  completed: () => void,
): Promise<void> {
  if (!billing.paddle) throw new Error('subscriptions are not sold on the website yet');
  const P = await load(billing.paddle);
  onCompleted = completed;
  P.Checkout.open({
    items: [{ priceId: billing.paddle.priceId, quantity: 1 }],
    ...(pilot.email ? { customer: { email: pilot.email } } : {}),
    customData: { pilotId: pilot.id },
    settings: {
      displayMode: 'overlay',
      allowLogout: false,
      theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    },
  });
}

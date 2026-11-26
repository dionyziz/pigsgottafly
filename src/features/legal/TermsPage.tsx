// /terms: the terms of service. Dated LEGAL_UPDATED; plain English.
import { Link } from 'react-router';

import { LegalPage, type LegalSection, Mail } from './LegalPage';

const sections: LegalSection[] = [
  {
    id: 'service',
    title: 'The service',
    body: (
      <>
        <p>
          Pig's Gotta Fly (pigsgottafly.com and the iPhone and iPad app) is a flight-planning tool for VFR flights in
          the Athinai FIR, provided by Common Prefix OÜ, a company registered in Estonia (registry code 16322929, VAT
          EE102415098, Lootsa 2a, 11415 Tallinn) ("we"). By signing in you agree to these terms. If you do not agree, do
          not use the service.
        </p>
        <p>
          We may change, add or remove features at any time, and we may stop the service; if we stop it, we will give
          you reasonable notice so that you can download your data, and refund the unused part of a subscription.
        </p>
      </>
    ),
  },
  {
    id: 'account',
    title: 'Your account',
    body: (
      <ul>
        <li>
          You sign in with your own Google account or Apple ID. Keep it secure: whoever can use it can use your Pig's
          Gotta Fly account.
        </li>
        <li>You must be at least 16 years old.</li>
        <li>One person per account. Do not sign in as, or create documents in the name of, someone else.</li>
      </ul>
    ),
  },
  {
    id: 'subscription',
    title: 'Subscription and payment',
    body: (
      <>
        <ul>
          <li>
            A new account gets a <b>30-day free trial</b>. After it, planning, briefing and filing need a subscription:
            <b> €50 a year</b>, VAT of your country included. Without one, your flights, aircraft and passengers stay
            yours to read, export and delete.
          </li>
          <li>
            Pilots who signed up before subscriptions began are <b>founding pilots</b> and keep everything free for
            life. People you share a flight or an aircraft with can view it without a subscription.
          </li>
          <li>
            On the website you pay through Stripe, our payment provider; in the iPhone and iPad app, through Apple. One
            subscription covers both.
          </li>
          <li>
            The subscription <b>renews every year</b> at the price then in force until you cancel it. Cancel any time:
            on the website under Subscription (account menu), or in the App Store settings for one bought in the app. It
            then runs to the end of the year already paid. We will tell you at least 30 days before a price change
            applies to your renewal.
          </li>
          <li>
            <b>Right of withdrawal</b>: as a consumer in the EU you may withdraw within 14 days of buying a subscription
            on the website, by writing to us, and we refund it in full. A subscription bought in the app is refunded
            through Apple (reportaproblem.apple.com).
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'responsibility',
    title: 'You are the pilot in command',
    body: (
      <>
        <p>
          The service helps you plan; it does not replace your judgement or your obligations as pilot in command. You
          remain responsible for every flight-planning decision and for the safe conduct of the flight. In particular,
          you must check against the official sources (the AIP Greece and its amendments, NOTAMs, official weather
          reports and forecasts, your aircraft's flight manual) everything the service shows or computes: routes,
          altitudes, airspace, aerodrome hours, headings and times, fuel, weight and balance, performance and weather.
        </p>
        <p>
          Reference data comes from the AIP for the AIRAC cycle shown in the app and from third-party providers, and may
          be incomplete, out of date or wrong. Calculations depend on the data you enter about your aircraft and flight.
        </p>
      </>
    ),
  },
  {
    id: 'documents',
    title: 'Documents you send to authorities and operators',
    body: (
      <>
        <p>
          The service can e-mail documents such as Form 731 and the General Declaration to the Hellenic Civil Aviation
          Authority (HCAA), send declarations to aircraft operators, and file flight plans, always{' '}
          <b>only when you ask it to</b> and in your name. You are responsible for:
        </p>
        <ul>
          <li>the accuracy and completeness of every document you send or file, and for sending it on time;</li>
          <li>
            having your passengers' agreement to enter their details and send them to the authority or operator (see the{' '}
            <Link to="/privacy">Privacy Policy</Link>);
          </li>
          <li>
            following up with the recipient if a document does not arrive or is not accepted. Delivery is not
            guaranteed.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'use',
    title: 'Acceptable use',
    body: (
      <>
        <p>Use the service only for planning real or intended flights and their documents. Do not:</p>
        <ul>
          <li>
            send e-mails to authorities or operators that are not about a real or planned flight, test messages,
            duplicates or anything that could flood their mailboxes (the service limits how many messages and signing
            links an account can send each day);
          </li>
          <li>impersonate another person, or enter or send someone's personal data without the right to do so;</li>
          <li>
            try to access another pilot's data, probe or overload the service, get around its limits, or interfere with
            its security;
          </li>
          <li>use it for anything unlawful.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'data',
    title: 'Your data',
    body: (
      <p>
        What you enter remains yours. You let us store and process it only to provide the service to you, as described
        in the <Link to="/privacy">Privacy Policy</Link>. When you share an aircraft with another pilot, they can see it
        and its files (and, with edit access, change them). You can download all your data or delete your account at any
        time from your <Link to="/profile">Profile</Link>.
      </p>
    ),
  },
  {
    id: 'termination',
    title: 'Ending your account',
    body: (
      <>
        <p>
          You can delete your account at any time (Profile → Delete account); this deletes your data as described in the
          Privacy Policy.
        </p>
        <p>
          We may suspend or close an account that breaks these terms, in particular the acceptable use rules, or that
          puts the service or others at risk. Where possible we will tell you first and let you download your data.
        </p>
      </>
    ),
  },
  {
    id: 'warranty',
    title: 'No warranty',
    body: (
      <p>
        Apart from the rights consumers have under mandatory law, the service is provided{' '}
        <b>"as is" and "as available"</b>, without any warranty, express or implied, including that it is accurate,
        complete, fit for a particular purpose, uninterrupted or free of errors.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <p>
        To the fullest extent the law allows, we are not liable for any loss or damage arising from the use of, or
        inability to use, the service, including from errors in data or calculations, documents not delivered or
        rejected, or flight-planning decisions; in any case our liability is limited to what you paid us in the 12
        months before the claim. Nothing in these terms limits liability that cannot be limited by law, such as for
        intent or gross negligence, or your rights as a consumer under mandatory law.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: (
      <p>
        These terms are governed by the laws of Estonia. The courts of Tallinn (Harju County Court) have jurisdiction,
        without prejudice to the mandatory protection of the law where you live and your right as a consumer to bring
        proceedings there.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms; the date at the top shows the current version. If a change is significant, we will
        tell you in the app before it applies. Continuing to use the service after that means you accept the new terms.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Common Prefix OÜ, Lootsa 2a, 11415 Tallinn, Estonia · registry code 16322929 · VAT EE102415098 · <Mail />
      </p>
    ),
  },
];

export function TermsPage() {
  return (
    <LegalPage
      current="terms"
      title="Terms of Service"
      lead={<p>The rules for using Pig's Gotta Fly, in plain English.</p>}
      sections={sections}
    />
  );
}

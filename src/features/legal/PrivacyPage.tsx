// /privacy: the privacy policy (GDPR). Describes what the code actually stores and sends: keep it in
// step with api/_lib/migrations (tables), api/_lib/routes and the external services in vercel.json's
// CSP (connect-src, img-src). Dated LEGAL_UPDATED.
import { Link } from 'react-router';

import { LegalPage, type LegalSection, Mail } from './LegalPage';

const sections: LegalSection[] = [
  {
    id: 'who',
    title: 'Who we are',
    body: (
      <>
        <p>
          Pig's Gotta Fly (pigsgottafly.com) is a free flight-planning service for VFR pilots in the Athinai FIR. It is
          run by an individual, Dionysis Zindros, based in Greece, who is the <b>controller</b> of the personal data
          described here under the EU General Data Protection Regulation (GDPR). In this policy "we" means him, and
          "you" means the pilot who has an account.
        </p>
        <p>
          Contact for anything about your data: <Mail />.
        </p>
      </>
    ),
  },
  {
    id: 'collect',
    title: 'What we collect',
    body: (
      <>
        <h3>Your Google account or Apple ID</h3>
        <p>
          You sign in with Google or with Apple. With Google, we receive and store your Google account's <b>name</b>,{' '}
          <b>e-mail address</b>, <b>profile picture address</b> and its unique <b>Google account identifier</b>. With
          Apple, we receive and store your <b>e-mail address</b> (your own, or the private relay address Apple makes for
          you if you choose <i>Hide My Email</i>), your unique <b>Apple user identifier</b>, and the <b>name</b> you
          choose to share, which Apple sends only the first time you sign in. We also store when your account was
          created and when you last signed in. We ask Google and Apple for nothing else: no contacts, no Drive, no
          Gmail, no iCloud data. If you sign in with Apple using the same, verified e-mail address as an existing
          account here (not a private relay address), that account is the one you sign in to. When a new account is
          created, the administrator receives an e-mail with its name and e-mail address.
        </p>
        <h3>Your session</h3>
        <p>
          When you sign in we give your browser a random session token in a cookie. The database keeps only a one-way
          hash of the token and when it was created, never the token itself.
        </p>
        <h3>Your pilot profile</h3>
        <p>
          What you enter in your profile, to fill in your flight documents: full name, phone, licence number,
          nationality, date of birth, ID or passport number, body weight (for weight and balance), aeroclub membership
          or relation, home aerodrome, default aircraft and your planning defaults.
        </p>
        <h3>Aircraft</h3>
        <p>
          The aircraft you add to your hangar: registration, type, operator, colours, equipment, fuel, mass and balance,
          performance tables, compass cards and notes, and the files you upload to them (photos, PDF documents such as
          the flight manual, compass swing reports).
        </p>
        <h3>Operators</h3>
        <p>
          The aircraft operators you add (flying clubs, schools, owners' companies): name, phone, e-mail, postal and
          AFTN addresses, notes, whether the operator asks for the weight and balance and performance sheets of each
          flight and the e-mail address they go to, and the documents you upload to it (for example the operations
          manual).
        </p>
        <h3>Your passengers' details</h3>
        <p>
          The people you enter in your passenger list or on a flight's manifest: names, phone numbers, dates of birth,
          ID or passport numbers, nationality, body weight, their relation to you and your notes. A flight's manifest
          keeps a copy of these details as they were when you added the person, so that the documents of that flight
          stay correct.
        </p>
        <h3>Flights</h3>
        <p>
          Your flights: date, times, aircraft, route and route points, altitudes and other per-leg choices, fuel,
          baggage, the manifest, the ATC frequency list and your options, including flights you moved to the trash. Also
          your saved custom waypoints.
        </p>
        <h3>Form signatures and signing links</h3>
        <p>
          For Form 731 you can create a signing link for each passenger. We store a hash of the link (not the link
          itself), when it was created, first and last opened, revoked, and when it expires. When a passenger signs, we
          store their name as signed, the time, and a hash of the version of the form they signed. Your own signature
          (as pilot in command) on the navigation log, Form 731, the General Declaration and the NOTAM briefing is your
          name and the time it was applied.
        </p>
        <h3>What you send</h3>
        <p>
          When you e-mail a form to the Hellenic Civil Aviation Authority (HCAA), or a declaration to an aircraft
          operator, we record when it was sent, to which address, the e-mail provider's message id and a hash of the
          version sent. When you use NOTAM briefings or file a flight plan, we keep the last briefing of the flight, the
          filed plan and its status, and a log of your filing actions.
        </p>
        <h3>Technical data</h3>
        <p>
          Like every website, our hosting provider receives your IP address and browser details with each request and
          keeps short-lived request logs for security and troubleshooting. To limit abuse, the app counts requests per
          account, and per IP address for sign-in attempts and other requests made without a session; these counters are
          kept for about two days at most. We do not use any of this to profile you.
        </p>
        <h3>Your location (the iPhone and iPad app)</h3>
        <p>
          When you allow it, the app reads your device's location while a flight's moving map is shown, to draw your
          aircraft and its progress along the route. This happens on your device only: your location is not sent to us
          or stored.
        </p>
      </>
    ),
  },
  {
    id: 'purposes',
    title: 'Why we use it, and on what legal basis',
    body: (
      <>
        <ul>
          <li>
            <b>To provide the service you signed up for</b>: planning flights, computing navigation, fuel, weight and
            balance and performance, and producing and, when you ask, sending your own flight documents (navigation log,
            Form 731, General Declaration, flight plan, briefings). Legal basis: performance of our agreement with you
            (GDPR Art. 6(1)(b)).
          </li>
          <li>
            <b>To keep the service secure and working</b>: sign-in, sessions, preventing abuse (for example limits on
            how many e-mails and signing links an account can create a day), fixing faults. Legal basis: our legitimate
            interest in a secure, reliable service (Art. 6(1)(f)).
          </li>
          <li>
            <b>To answer you</b> when you write to us. Legal basis: legitimate interest.
          </li>
        </ul>
        <p>We do not sell your data, show advertising, or use your data for marketing or to train models.</p>
        <h3>Data about other people that you enter</h3>
        <p>
          When you enter your passengers' details, or send a form about them to an authority or operator, you decide
          what is entered and why, and we process it on your behalf to produce and send your documents. You are
          responsible for having a lawful basis for that: in practice, telling your passengers that their details will
          be used for the flight's documents and given to the HCAA or the operator, and getting their consent where
          required. Delete passengers you no longer fly with.
        </p>
      </>
    ),
  },
  {
    id: 'recipients',
    title: 'Who receives data',
    body: (
      <>
        <p>We use these service providers (processors), each only for the purpose shown:</p>
        <table className="legal-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>What for, and what they receive</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Vercel</td>
              <td>Hosting of the website and its server. Every request passes through it.</td>
            </tr>
            <tr>
              <td>Neon</td>
              <td>Database hosting: stores everything described in section 2.</td>
            </tr>
            <tr>
              <td>Resend</td>
              <td>
                Sends the e-mails you ask us to send (forms to the HCAA, declarations to operators), including the PDF
                attached.
              </td>
            </tr>
            <tr>
              <td>Google</td>
              <td>Sign-in (Google Identity Services). Your profile picture is loaded from Google's servers.</td>
            </tr>
            <tr>
              <td>Apple</td>
              <td>Sign in with Apple. Its sign-in script and window are loaded from Apple's servers.</td>
            </tr>
          </tbody>
        </table>
        <p>These services receive only what they need to do their job, and only from your use of the app:</p>
        <table className="legal-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>What it receives</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Open-Meteo</td>
              <td>
                Weather forecasts: your browser sends the coordinates and times of points along your route. No names or
                account data.
              </td>
            </tr>
            <tr>
              <td>aviationweather.gov</td>
              <td>METAR and TAF reports: our server sends the ICAO codes of the aerodromes. No personal data.</td>
            </tr>
            <tr>
              <td>Map tile servers</td>
              <td>
                OpenFreeMap, OpenStreetMap, OpenTopoMap and openflightmaps (via newaydata) serve the map images your
                browser displays; like any website they see your IP address and the map area you view.
              </td>
            </tr>
            <tr>
              <td>autorouter</td>
              <td>
                NOTAM briefings and flight-plan filing, through this service's own autorouter account, only for the
                pilots that account is enabled for. For a briefing: the flight's route area and times. For filing: the
                flight plan (aircraft, route, times, endurance, persons on board, and the pilot in command's name and
                phone in item 19).
              </td>
            </tr>
            <tr>
              <td>International NOTAM feed</td>
              <td>
                NOTAM briefings, through this service's own account with a NOTAM distribution service: our server sends
                the ICAO codes of the aerodromes on and near the route and the FIR. No personal data.
              </td>
            </tr>
            <tr>
              <td>Notamify</td>
              <td>
                NOTAM briefings, through this service's own Notamify account: our server sends the ICAO codes of the
                aerodromes on and near the route and the FIR, and the flight's date. No personal data.
              </td>
            </tr>
            <tr>
              <td>HASP eAIP</td>
              <td>
                AIP references are links to the official AIP Greece documents; when you open one, your browser loads it
                from the Hellenic Air Navigation Service Provider's site.
              </td>
            </tr>
          </tbody>
        </table>
        <h3>Recipients you choose</h3>
        <ul>
          <li>
            <b>The HCAA</b>: when you press send, Form 731 or the General Declaration is e-mailed as a PDF to the HCAA's
            address for that form, with the names, ID or passport numbers, contact details and other details on the
            form. You are copied and are the reply-to address.
          </li>
          <li>
            <b>Aircraft operators</b>: when an operator asks for them and you press send, the weight and balance and
            performance sheets of the flight (aircraft, date, route, loading, masses and centre of gravity, take-off and
            landing performance) are e-mailed as a PDF to the operator's declarations address, with you copied and as
            the reply-to address.
          </li>
          <li>
            <b>Your passengers</b>: a signing link shows the person it was made for their own details in full and the
            other people on the form with their ID and phone partly hidden. You decide whom you give a link to.
          </li>
          <li>
            <b>Pilots you share with</b>: when you share an aircraft or an operator, the other pilot sees it, its files,
            and who it is shared with (names and e-mail addresses). Everyone who can see an aircraft also sees its
            operator. When someone shares an aircraft or an operator with you, they and the others it is shared with see
            your name and e-mail.
          </li>
          <li>
            <b>People you share a flight with</b>: you can share a flight with people you choose, by their e-mail
            address, also when they have no account yet. They see the whole flight as you planned it, including its
            manifest (the names and details of the pilot and passengers on board), its aircraft, its briefing and the
            state of its forms and flight plan, and who else it is shared with; an editor can also change it. We e-mail
            them that you shared it (with your name and e-mail), and keep the address of someone without an account
            until they sign in with it or you remove them. Only you file the flight plan and send its forms.
          </li>
        </ul>
        <p>We disclose data to authorities only when the law requires it.</p>
      </>
    ),
  },
  {
    id: 'transfers',
    title: 'International transfers',
    body: (
      <p>
        Vercel, Neon, Resend, Google and Apple are based in the United States and may process data outside the European
        Economic Area. Where they do, the transfer is covered by the EU–US Data Privacy Framework or by the European
        Commission's Standard Contractual Clauses in their data processing terms.
      </p>
    ),
  },
  {
    id: 'retention',
    title: 'How long we keep it',
    body: (
      <>
        <ul>
          <li>
            Your account, profile, aircraft, files, passengers, waypoints and flights: until you delete them, or until
            you delete your account.
          </li>
          <li>
            Flights you delete go to the trash, where you can restore them. They stay there until you delete your
            account.
          </li>
          <li>
            Sessions: until you sign out (on one device, or everywhere from the account menu), or 90 days after you last
            used the app on that device.
          </li>
          <li>
            Signing links stop working at the end of the day after the flight, or 14 days after they were made if that
            comes first; their record stays with the flight.
          </li>
          <li>
            The record of e-mails sent (when, the kind of form, the recipient's address, the subject and whether it went
            out) stays with your account, to apply the daily sending limits, to show you what was sent and to let the
            administrator look into abuse.
          </li>
          <li>
            Request counters for rate limiting: per account, or per IP address for requests made before signing in;
            about two days at most.
          </li>
          <li>
            Deleted data can remain in the database provider's backups and restore history for a limited time (up to
            about 30 days) before it is overwritten. E-mails you sent are kept by their recipients, and flight plans you
            filed are kept by autorouter and the ATS, under their own rules.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <>
        <p>Under the GDPR you have the right to:</p>
        <ul>
          <li>
            <b>Access</b> your data and receive a copy: <Link to="/profile">Profile</Link> → <i>Download my data</i>{' '}
            gives you everything your account holds as a JSON file.
          </li>
          <li>
            <b>Portability</b>: that same file is in a structured, machine-readable format.
          </li>
          <li>
            <b>Rectification</b>: you can correct everything in the app yourself (profile, passengers, aircraft,
            flights).
          </li>
          <li>
            <b>Erasure</b>: <Link to="/profile">Profile</Link> → <i>Delete account</i> deletes your account and
            everything it owns at once: profile, passengers, waypoints, flights (including the trash), aircraft and
            operators you own with their files (also when shared with other pilots), shares, signing links, signatures
            and records of what you sent, and signs you out everywhere.
          </li>
          <li>
            <b>Object</b> to processing based on legitimate interest, and to <b>restrict</b> processing.
          </li>
          <li>
            <b>Complain</b> to a data protection authority. In Greece that is the Hellenic Data Protection Authority (
            <a href="https://www.dpa.gr" target="_blank" rel="noreferrer">
              dpa.gr
            </a>
            , Kifisias 1-3, 115 23 Athens). You can also complain where you live or work in the EU.
          </li>
        </ul>
        <p>
          For anything you cannot do in the app, write to <Mail />. We answer within one month.
        </p>
        <p>
          If you are a passenger whose details a pilot entered, the pilot decides about that data; ask them first. You
          can also write to us and we will help.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies and local storage',
    body: (
      <>
        <p>
          We use <b>one cookie</b>: <code>pgf_session</code>, which keeps you signed in. It is strictly necessary,
          HttpOnly (scripts cannot read it), sent only to this site, and lasts until you sign out or 90 days after you
          last used the app. Google's and Apple's sign-in may set their own cookies on their own domains when you use
          them.
        </p>
        <p>
          The app keeps some things in your browser's local storage: layout preferences (panel sizes, map layers,
          collapsed sections) and a copy of the flights you open, so that you can keep working offline. These never
          leave your device except when the app saves the flight to your account. Deleting your account clears them from
          that browser.
        </p>
        <p>
          There is <b>no analytics, no tracking, no advertising</b> and no third-party script other than Google's and
          Apple's sign-in.
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <p>
        All traffic is encrypted (HTTPS). Session tokens and signing links are stored only as hashes. Every request is
        checked against the signed-in account, so a pilot can never reach another pilot's data unless it was shared with
        them. Strict browser security headers limit what the site can load. No system is perfectly secure; if we learn
        of a breach that affects your data, we will tell you and the authority as the law requires.
      </p>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        The service is for pilots and is not meant for anyone under 16. Do not create an account if you are under 16.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We will update this page when what we collect or whom we share it with changes, and change the date at the top.
        If a change is significant, we will tell you in the app or by e-mail before it applies.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Dionysis Zindros, Greece · <Mail />
      </p>
    ),
  },
];

export function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      title="Privacy Policy"
      lead={
        <p>
          What Pig's Gotta Fly stores about you and the people you fly with, why, who else sees it, and how you can get
          it or delete it.
        </p>
      }
      sections={sections}
    />
  );
}

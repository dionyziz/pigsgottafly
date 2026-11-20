// /support: help and contact, public (the App Store's support URL).
import { Link } from 'react-router';

import { LegalPage, type LegalSection, Mail } from './LegalPage';

const sections: LegalSection[] = [
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions, problems or ideas: write to <Mail />. Include the flight's link if it is about a flight. We answer
        within a few days.
      </p>
    ),
  },
  {
    id: 'start',
    title: 'Getting started',
    body: (
      <ol>
        <li>Sign in with your Google account or Apple ID.</li>
        <li>Fill in your profile: your name and phone go on the flight plan and the forms.</li>
        <li>Add your aircraft to the hangar, or ask its owner or your club to share it with you.</li>
        <li>
          Create a flight, draw the route on the map, and follow the <b>Ready to fly</b> list at the top of the flight's
          panel: Plan, Brief, then File & forms.
        </li>
      </ol>
    ),
  },
  {
    id: 'app',
    title: 'The iPhone and iPad app',
    body: (
      <p>
        The app is the same planner as pigsgottafly.com, with your flights in both. It needs a connection to open; print
        the navlog before you go.
      </p>
    ),
  },
  {
    id: 'data',
    title: 'Your data and your account',
    body: (
      <p>
        You can download all your data, or delete your account and everything in it, from your profile. See the{' '}
        <Link to="/privacy">Privacy Policy</Link> for what is kept and why.
      </p>
    ),
  },
];

export function SupportPage() {
  return (
    <LegalPage
      current="support"
      title="Support"
      lead={<p>Help with Pig's Gotta Fly, VFR flight planning for the Athinai FIR.</p>}
      sections={sections}
    />
  );
}

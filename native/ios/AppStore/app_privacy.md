# App Privacy answers (App Store Connect → App Privacy)

Kept in step with `native/ios/PigsGottaFly/PrivacyInfo.xcprivacy` and the privacy policy at https://pigsgottafly.com/privacy
(`src/features/legal/PrivacyPage.tsx`).

**Do you or your third-party partners collect data from this app?** Yes.

**Tracking:** No. The app does not track users across other companies' apps or websites, has no advertising,
no third-party advertising or analytics SDKs, and shares no data with data brokers.

## Data collected

Every type below: **linked to the user** (it belongs to the pilot's account), **not used for tracking**,
purpose **App Functionality** only.

| App Store category | Data type | What it is in the app |
| --- | --- | --- |
| Contact Info | Name | Account name from Sign in with Apple or Google; the pilot's full name in the profile |
| Contact Info | Email Address | Account e-mail from Sign in with Apple or Google |
| Contact Info | Phone Number | The pilot's phone in the profile (for the flight plan and forms) |
| Identifiers | User ID | The account identifier from Apple or Google sign-in |
| User Content | Photos or Videos | Aircraft photos the pilot uploads to the hangar |
| User Content | Other User Content | Flights, routes, aircraft, operators, waypoints, and the passengers' details the pilot enters (names, phone numbers, dates of birth, ID or passport numbers, weights) for the flight documents |
| Diagnostics | Crash Data | Reports of the app's own errors (page path and error message, no request bodies) |

## Not collected

Location (see the notes), health and fitness, financial info, contacts, browsing history, search history, purchases,
usage data / product interaction analytics, advertising data, audio, gameplay content, customer support
records, sensitive info, other diagnostic data (performance data), device ID.

## Notes for the questionnaire

- Data the pilot types about passengers counts as "Other User Content" collected from the user of the app.
- Location: Fly mode reads the GPS (when in use) to draw the aircraft on the map and its progress along the
  route. That happens on the device only: the position is not sent to the server or anyone else and is not
  stored (the app's code sends no position in any request: the API calls are the flight, the aircraft, the
  profile, the reference data, the weather and the NOTAMs). Apple: "Data that is processed only on device is
  not 'collected'", so Location is answered **not collected**. The map tiles for the area on screen come from
  OpenFreeMap / OpenStreetMap, as in any map app.
- The hosting provider's short-lived request logs (IP address) are for security and are not "collected" in
  Apple's sense (not kept beyond what is needed to serve the request).

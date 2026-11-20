# UX review and plan (draft for discussion)

The app has grown feature by feature, mostly in response to specific problems. Each feature works, but
the whole has not been designed as one flow. This review looks at the app from the pilot's side:
who uses it, what they are trying to get done, and where the interface makes that harder than it
needs to be. The plan only proposes changes that remove real friction. The map-first editor, the
navlog strip and the print exports are right and stay.

Evidence used: the screens as they are today, and the problems the pilot reported while the app was
being built. These include NOTAM clutter, duplicated warnings, tooltips that showed only one thing,
details that could not be reached, a warnings toggle that did not look toggled, and altitudes that
did not follow the terrain. Most of those were symptoms of the structural issues below.

## 1. Personas

**Eleni: low-hours club PPL (primary).** About 120 h. Member of an aeroclub at LGTT. Flies a club
C172 once or twice a month: local flights around the Saronic, and a few times a year an island trip
(Syros, Milos, Kythira) with a friend or two. She plans on a laptop the evening before and checks on
her phone in the morning.
- She is careful and a little anxious about getting something wrong. That could be an airspace
  infringement, a missed PPR, a wrong FPL addressee, a forgotten Form 731 or W&B over the limit.
- The Greek AIP is long, the rules are spread across GEN, ENR and AD, and the club's paperwork rules
  live in people's heads.
- What she wants from the app: "Tell me what I must do, in order, and tell me when I'm done."

**Nikos: experienced owner or renter (secondary).** About 700 h. Flies most weekends, often the
same few trips. Knows the procedures and finds checklists tedious.
- Wants speed: copy last month's LGTT–LGSY flight, change the date and the passengers, file, print.
- He reads NOTAMs and METARs quickly, but only the ones that matter to him.
- He uses the app on his phone a lot, including at the aerodrome.

**The club's operations officer or instructor (tertiary).** Doesn't plan the flights, but needs the
W&B and performance sheets and the flight plan copies to arrive by e-mail. Sets the operator's
requirements once in the operator settings, and otherwise never opens the app.

**A passenger (tertiary).** Opens a signing link on a phone for Form 731 and signs. Their
experience is a single screen.

## 2. What pilots are trying to get done (jobs)

| # | Job | When |
|---|-----|------|
| J1 | Sketch the trip: where, when, which aircraft, who comes | days before |
| J2 | Get a legal, sensible route: airspace, VFR routes, altitudes, terrain | days before |
| J3 | Know the numbers: time, fuel, W&B, take-off and landing distances | days before / evening |
| J4 | Handle the paperwork: PPR, flight plan, Form 731, GenDec, the club's sheets | evening before |
| J5 | Decide go or no-go: weather, NOTAMs, aerodrome hours, sunset | morning of |
| J6 | File the flight plan, delay or cancel it | morning of |
| J7 | Take it into the cockpit: navlog, frequencies, the briefing on the kneeboard | before departure |
| J8 | Do it again quickly next time | any time |

The one thing that ties all of these together: **"Am I ready to fly, and if not, what's left?"**
The app currently has no single answer to that question.

## 3. Findings

Each finding names the usability heuristic it breaks (Nielsen) and the jobs it affects.

### F1. The flight panel is one long list of 12 sections, mixing three different activities (J1–J7)
Route, When, Aircraft, Manifest, Fuel, Aerodrome hours, METAR, Take-off & landing, NOTAMs, ATC,
Flight plan and Documents all sit in one scrolling column. They fall into three groups:
- **things the pilot decides** (route, time, aircraft, people, fuel);
- **things the app works out to brief her** (hours, METAR, performance, NOTAMs, ATC);
- **things she has to produce** (flight plan, forms, prints).

Because the three are interleaved, there is no visible order of work and no sense of being done. The
column also keeps growing as features are added.
*Heuristics:* match with the real world (pilots think plan, then brief, then file); recognition rather
than recall.

### F2. Warnings and to-dos are scattered (J4, J5)
Problems show up in several separate places:
- the navlog strip's warnings page;
- a badge on the Documents section;
- inside individual sections (e.g. aerodrome closed);
- on the export pages.

Some are calculation warnings (fuel, W&B, terrain). Others are paperwork that hasn't been done yet
(flight plan not filed, Form 731 not sent, PPR). Others are hazards to brief (thunderstorms, NOTAMs).
None of them can be ticked off: the pilot has to remember what she has already dealt with. The
duplicated sunset warning was one symptom of several sources producing the same message.
*Heuristics:* visibility of system status; consistency; error prevention.

### F3. Filing, the most consequential action, sits inside a print page (J6)
To file, the pilot opens the "Flight plan (AFTN)" export in a new tab and uses the Filing panel
there. Whether a plan has been filed, and its status, isn't visible in the editor or in the flight
list. The morning-of tasks (file, check the status, delay) therefore need a page whose main purpose
is a printout.
*Heuristics:* visibility of system status; match with the real world.

### F4. Prints are six separate tabs (J7)
Navigation log, Form 731, General Declaration, Flight plan, W&B and performance, and NOTAM briefing
each open their own tab. Before a flight, the pilot needs most of them together in one printout for
the kneeboard and the club. She has to open each one, print it, and remember which she has done.
*Heuristics:* flexibility and efficiency; minimise memory load.

### F5. The map shows everything, everywhere, at the same weight (J2, J5)
Airspaces, areas, VFR routes and points, navaids, NOTAMs and weather are all drawn equally, whether
they are on the route or 60 NM away. The recent fixes (filtering NOTAMs, toning them down, putting
everything under the pointer in one box) addressed the worst of this. The underlying issue remains:
nothing on the map is shown in proportion to its relevance to *this* flight.
*Heuristics:* aesthetic and minimalist design; signal-to-noise.

### F6. Morning-of decisions need information from four places (J5)
METAR appears in the panel when the flight is near. NOTAMs are in their own section. Aerodrome hours
and sunset are in another section. The forecast winds sit in the navlog. A go/no-go decision draws on
all of them, and on a phone this means scrolling past planning inputs to find them.
*Heuristics:* visibility of system status; match with the real world (the "go/no-go" moment).

### F7. Reuse is possible but hidden (J8)
"Make a copy" is in the ⋮ menu of the flight list. The copy keeps the old date and title, so the
pilot then has to find and change both. Recurring trips are the common case, especially for Nikos.
*Heuristics:* flexibility and efficiency of use.

### F8. The first flight has a steep start (J1)
A new pilot has to set up the profile, the aircraft (hangar or a club share), the operator and
passengers before the app can work everything out. The editor shows what's missing as warnings, but
it doesn't lead her through it.
*Heuristics:* help users recognise, diagnose and recover; match with the real world.

### F9. Phone use, in the morning and at the aerodrome, is the least developed (J5, J6)
The editor works on a narrow screen, but it is a desktop layout made smaller: a map plus a long panel.
The morning-of jobs are read-mostly and short, which is exactly what phones are good at.

### What already works well (keep)
- The map-first editor, where the route is the main object, and dragging and snapping to VFR points.
- The navlog strip under the map: always visible, editable altitudes, warnings per leg.
- "Fix →" on warnings, which takes the pilot to the field concerned. It should be used everywhere.
- Server-side relevance (NOTAMs, aerodromes in use, terrain): the app does the AIP reading.
- Print exports that look like the official forms.

## 4. Plan

These are ordered by impact on the pilot divided by the cost to build. Each step can ship on its own.

### Step 1: one readiness list (fixes F2, part of F1 and F6)
Add a **Ready to fly** summary at the top of the flight panel: a short checklist the app keeps up to
date, grouped by stage.
- **Plan:** route complete · altitudes set · fuel and reserves OK · W&B within limits · performance
  margins.
- **Brief:** aerodromes open at the planned times · before sunset · NOTAMs read (n relevant) ·
  weather (METAR/TAF once available).
- **Paperwork:** PPR (where the AIP requires it) · flight plan filed · Form 731 signed and sent ·
  GenDec (international) · the operator's sheets sent.

Each line is ✓, a warning or a danger, with "Fix →". Some lines are acknowledgements the pilot ticks
herself, such as "NOTAMs read", recorded per flight. This list replaces the Documents section's issue
badge as the place to look, and the navlog warnings page becomes a view of the same data. The flight
list shows the summary per flight: "Ready", "2 to do", or "Filed".

### Step 2: three stages in the panel (fixes F1)
Group the existing sections under three tabs or headings that follow the work:
- **Plan:** Route, When, Aircraft, Manifest & loading, Fuel.
- **Brief:** Weather (METAR/TAF), NOTAMs, Aerodromes (hours, runways, performance), ATC.
- **File & print:** Flight plan with filing, Forms (731, GenDec, the operator's sheets), Print.

Each tab shows the status of its part of the readiness list. Nothing is removed; this is a regrouping,
plus the readiness list from step 1 as the header. On a phone, the tabs are the main navigation.

### Step 3: filing in the editor (fixes F3)
Move the Filing panel into File & print, next to the flight plan. The print export keeps the form.
Show the filing status as a chip in the editor's top bar and in the flight list ("Filed 11:00Z",
"Delayed", "Cancelled"), with Delay and Cancel one click away.

### Step 4: one print for the flight (fixes F4)
Add **Print briefing pack**: one document with the navlog, W&B and performance, the flight plan form
and the NOTAM briefing, in that order. A checkbox per part, remembered per pilot. Form 731 and GenDec
stay separate because they go to other people. The six existing exports stay, for anyone who wants
just one.

### Step 5: "Fly again" (fixes F7)
Next to each flight in the list: **Fly again**. It copies the flight with today's date (or the next
free day), keeps the route, aircraft and people, clears the filing and the signatures, and opens the
copy. The title follows the route, not "Copy of …".

### Step 6: a map that follows the route (fixes F5)
- By default, airspaces, areas and NOTAMs more than the corridor's width from the route are drawn
  faint. Hovering or zooming in shows them fully, and a "show everything" toggle stays in the layer
  menu.
- Anything that affects a leg (a TMA boundary crossed, a danger area active at the planned time)
  stands out more. This uses the relevance the server already computes for NOTAMs.

### Step 7: first-flight guidance (fixes F8)
When the profile, aircraft or PIC details are missing, the readiness list (step 1) shows them first,
each with a "Fix →" that opens the right page and returns to the flight. No tour and no extra screens.

### Step 8: a morning view on the phone (fixes F6, F9)
On a phone, the Brief stage is the default when the flight is today. It shows the go/no-go summary,
then METAR/TAF for the route's aerodromes, the relevant NOTAMs, sunset, aerodrome hours and filing
status, with the map one tap away. This is mostly step 2 with a different default on small screens.

### Deliberately not proposed
- A wizard or step-by-step mode. Experienced pilots plan in any order and the map is the centre;
  stages are a grouping, not a gate.
- Redesigning the visual style, the map styling, or the print forms.
- New data sources. The gaps are in how existing information is organised, not missing information.

## 5. How to check it works

Before building steps 2, 6 and 8, run short sessions with 3–5 club pilots: two low-hours, one or two
experienced, one instructor. Give them these tasks:
1. Plan a local flight and say whether you can fly it tomorrow.
2. Plan LGTT → Syros with two passengers and get everything ready to fly.
3. It's the morning of the flight: decide go/no-go and file.
4. Repeat last weekend's trip for next Saturday.

Measure time per task, the number of places visited to answer "am I ready?", and whether anything
required was missed (Form 731, PPR, filing). Steps 1, 3, 4 and 5 are low-risk and can go first.

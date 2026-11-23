// ENR 5 navigation-warning areas: tools/parse_enr5.ts against verbatim AIP text, and checks over the
// generated tools/enr5_areas.json.
import fs from 'node:fs';

import { describe, expect, test } from 'vitest';

import type { RefArea } from '../../../src/shared/ref';
import {
  normLimit,
  parseCoord,
  parseEnr51,
  parseEnr52,
  parseEnr53,
  parseLateral,
  parseSups,
  splitActivity,
  supNumber,
  supValidTo,
} from '../../../tools/parse_enr5';

// ---- Verbatim excerpts (pdftotext -layout) of AIP Greece ENR 5, AIRAC 09/26:
// ENR 5.1 pages 1, 3, 4 and 9; ENR 5.2 page 1; ENR 5.3 page 1.

const ENR51_P1 = String.raw`AIP                                                                                                                ENR 5.1-1
GREECE                                                                                                          08 AUG 2024

                                                   ENR 5. NAVIGATION WARNINGS
                        ENR 5.1 PROHIBITED, RESTRICTED DANGER AND CONTROLLED FIRING AREAS


                   Identification                                                             Remarks
                                                          Upper limit
                      Name                                                (time of activity, type of restriction, nature of
                                                          Lower limit
                   Lateral limits                                                  hazard, risk of interception)
                         1                                    2                                  3
 5.1.1   PROHIBITED AREAS            (see also ENR 1.1)
 LGP1                                                                   H24
 ACROPOLIS                                                              Prohibited to all flights.
                                                          5000 FT ALT   Archaeological Monuments protected area.
 A circle, 700 M radius centered on                          GND        a) Propeller aircraft above 5000 FT
 375820N 0234333E.                                                      b) Jet aircraft above 10000 FT

 LGP4                                                                   H24
 LAKI (LEROS ISLAND)                                                    Prohibited to GAT flights and UAS.
                                                          3000 FT ALT
 370604N 0265005E - 371008N 0265005E -                     GND/MSL
 370608N 0265104E - 370604N 0265104E -
 370604N 0265005E.
 LGP5                                                                   H24
 PARTHENI (LEROS ISLAND)                                                Prohibited to GAT flights and UAS.
                                                          3000 FT ALT
 371145N 0264701E - 371008N 0264701E -                     GND/MSL
 371008N 0264709E - 371145N 0264709E -
 371145N 0264701E.
 LGP6                                                                   H24
 MOTOR OIL (KORINTHOS REFINERIES)                                       Prohibited to GAT flights and UAS.
                                                          2000 FT ALT
 375411N 0230258E - 375411N 0230540E -                     GND/MSL
 375546N 0230540E - 375546N 0230258E -
 375411N 0230258E.

 LGP7                                                                   H24
 REVYTHOUSSA (FLARESTACK –                                              Prohibited to GAT flights and UAS.
 REVYTHOUSSA ISLAND)
                                                          1000 FT ALT
 375800N 0232350E - 375800N 0232430E -                       GND
 375730N 0232430E - 375730N 0232350E -
 375800N 0232350E.

 LGP8                                                                   H24
 VIKOS                                                                  Prohibited to GAT flights.
                                                          7000 FT ALT   Environmentally protected area.
 400400N 0205400E - 395100N 0205400E -                       GND
 395400N 0204000E - 400200N 0204000E -
 400400N 0205400E.

 LGP9                                                                   H24
 PAPAGOS                                                                Prohibited to GAT flights and UAS.
                                                          2000 FT ALT
 A circle, 1.5 NM radius centered on                         GND
 380003N 0234659E.

 LGP10                                                                  H24
 MILITSA (KASTORIA)                                                     Prohibited to GAT flights and UAS.
                                                          5000 FT ALT
                                                                        Protection of Fur Farms.
                                                             GND
 A circle, 1 NM radius centered on
 402830N 0212020E.
 LGP12                                                                  H24
 KORIDALLOS (PIRAEUS)                                                   Prohibited to GAT flights and UAS.
                                                          5000 FT ALT
                                                             GND
 A circle, 1.5 NM radius centered on
 375900N 0233845E.
 LGP13                                                                  H24
 METEORA (KALABAKA)                                                     Prohibited to GAT flights and UAS.

 394424N 0213746E - 394328N 0213948E -                    4000 FT ALT
 394150N 0213827E - 394245N 0213753E -                       GND
 394219N 0213700E - 394237N 0213620E -
 394424N 0213746E.




HELLENIC AVIATION SERVICE PROVIDER                                                                        AIRAC AMDT 07/24
`;

const ENR51_P3 = String.raw`AIP                                                                                                     ENR 5.1-3
GREECE                                                                                               02 NOV 2023


                   Identification                                                  Remarks
                                               Upper limit
                      Name                                     (time of activity, type of restriction, nature of
                                               Lower limit
                   Lateral limits                                       hazard, risk of interception)
                         1                         2                                  3
 5.1.2   RESTRICTED AREAS (see also ENR 1.1)
 LGR14                                                       H24
 NEA CARVALI - CONSTRUCTION DOCK                             NORTH AEGEAN CONCESSION AREA
                                                             No aircraft shall be flown in this area except by
 A circle, 800 M radius centered on            2000 FT ALT   special permission granted by HCAA / ATS Division.
 405722N 0243226E.                              GND/MSL      Relative application shall be submitted five days in
                                                             advance.
                                                             The radius of this area is 500 M from the extremities
                                                             of the constructions.
 LGR15                                                       H24
 PLATFORM ALFA - PRINOS FIELD COMPLEX                        NORTH AEGEAN CONCESSION AREA
                                               2000 FT ALT   No aircraft shall be flown in this area except by
 A circle, 500 M radius centered on             GND/MSL      special permission granted by HCAA / ATS Division.
 404755N 0242943E.                                           Relative application shall be submitted five days in
                                                             advance.

 LGR16                                                       H24
 PLATFORM BETA                                               NORTH AEGEAN CONCESSION AREA
                                               2000 FT ALT   No aircraft shall be flown in this area except by
 A circle, 500 M radius centered on             GND/MSL      special permission granted by HCAA / ATS Division.
 404753N 0242948E.                                           Relative application shall be submitted five days in
                                                             advance.

 LGR17                                                       H24
 PLATFORM DELTA                                              NORTH AEGEAN CONCESSION AREA
                                                             No aircraft shall be flown in this area except by
 A circle, 500 M radius centered on            2000 FT ALT   special permission granted by HCAA / ATS Division.
 404752N 0242943E.                              GND/MSL      Relative application shall be submitted five days in
                                                             advance.
                                                             The installation is equipped with a helideck,
                                                             elevation 87 FT AMSL.
 LGR18                                                       H24
 SOUTH KAVALA (PLATFORM KAPPA)                               NORTH AEGEAN CONCESSION AREA
                                               2000 FT ALT   No aircraft shall be flown in this area except by
 A circle, 500 M radius centered on             GND/MSL      special permission granted by HCAA / ATS Division.
 404202N 0242627E.                                           Relative application shall be submitted five days in
                                                             advance.
 LGR19                                                       H24
 MOORING AND LOADING FACILITIES                              NORTH AEGEAN CONCESSION AREA
 (ANCHORAGE)                                   2000 FT ALT   No aircraft shall be flown in this area except by
                                                GND/MSL      special permission granted by HCAA / ATS Division.
 A circle, 500 M radius centred on                           Relative application shall be submitted five days in
 405555N 0243123E.                                           advance.
 LGR20                                                       H24
 SALAMIS                                                     Navy.
                                                             Aircraft may cross the area from any direction and
 LGR20A SALAMIS                                              at any altitude above 2000 FT without restriction,
                                               2000 FT ALT   but circling the area at any altitude should be
 375500N 0232550E - 375550N 0232505E -                       avoided, except for holding over EGN NDB.
                                                GND/MSL
 380000N 0233010E - 380130N 0233530E -
 375355N 0233210E - 375500N 0232550E.
 LGR20B SALAMIS
                                               1000 FT ALT
 380130N 0233530E - 375800N 0234030E -          GND/MSL
 375355N 0233210E - 380130N 0233530E.

 LGR22                                                       SR-SS
 SKOURTA                                                     Training Flights.
                                               5000 FT ALT   This area is used only in VMC conditions by
 381536N 0233037E - 381201N 0232816E -            GND        inexperienced cadet pilots.
 380840N 0233632E - 381215N 0233853E -
 381536N 0233037E.




HELLENIC AVIATION SERVICE PROVIDER                                                            AIRAC AMDT 10/23
`;

const ENR51_P4 = String.raw`ENR 5.1-4                                                                                                     AIP
25 JAN 2024                                                                                               GREECE


                Identification                                                    Remarks
                                              Upper limit
                   Name                                       (time of activity, type of restriction, nature of
                                              Lower limit
                Lateral limits                                         hazard, risk of interception)
                      1                           2                                    3
5.1.2   RESTRICTED AREAS (see also ENR 1.1)
 LGR23                                                      SR-SS
 MARATHONAS                                                 Training Flights.
                                                            This area is only used in VMC conditions by
 LGR23A MARATHONAS                                          inexperienced cadet pilots.

 381000N 0240200E - 381000N 0241100E -
 381300N 0241600E - 381800N 0241800E -        5000 FT ALT
 381800N 0240400E - 381400N 0240400E -         GND/MSL
 381400N 0240200E - 381000N 0240200E.


 LGR23B MARATHONAS

 381000N 0240200E - 381100N 0240200E -        3000 FT ALT
 381100N 0235000E - 381000N 0235000E -           GND
 381000N 0240200E.

 LGR24                                                      SR-SS.
 MENIDI                                                     Restricted to all, non-participating GAT flights.
                                              5000 FT ALT   Training Flights.
 380721N 0233857E - 380304N 0233958E -        3500 FT ALT   This area is used only in VMC conditions by
 380153N 0233912E - 380308N 0233611E -                      inexperienced cadet pilots.
 380721N 0233857E.
 LGR25                                                      SR-SS
 LEFKTRA                                                    Hellenic Air force \Training Flights
                                                            The area is activated under the authorization of
 381500N 0230000E - 380900N 0230100E -        5000 FT ALT   TANAGRA APP.
 381000N 0231500E - 381500N 0231500E -         GND/MSL
 381500N 0230000E.


 LGR26                                                      SR-SS
 PLATEAI                                                    Hellenic Air force Training Flights.
                                                            The area is activated under the authorization of
 381500N 0231500E - 381000N 0231500E -        5000 FT ALT   TANAGRA APP.
 381000N 0232400E - 381500N 0232400E -           GND
 381500N 0231500E.


 LGR27                                                      MON 0400 -1200
 LITHINON                                                   TUE, WED, THU 0400-1200 and 1600-2100
                                                            FRI 0400-1200
 350000N 0242800E - 344600N 0245400E -                      except HOL
                                                FL 240
 344900N 0251900E - 350000N 0251900E -                      Training Flights
 350000N 0245500E - 350500N 0245500E -         GND/MSL      ATS Routes affected:
 350700N 0244700E - 350000N 0244800E -                      a) AWY M978 (TIPUS-OTREX)
 350000N 0242800E.                                          b) AWY R78 (TIPUS-OTREX)


 LGR28                                                      Activated by NOTAM
 SOUDA                                                      PPR required by SOUDA APP Unit, before
                                                            commencing the activities.
 353008N 0240402E - 352809N 0240402E -        1000 FT ALT
 352809N 0241003E - 353008N 0241003E -         GND/MSL
 353008N 0240402E.




AIRAC AMDT 01/24                                                    HELLENIC AVIATION SERVICE PROVIDER
`;

const ENR51_P9 = String.raw`AIP                                                                                                             ENR 5.1-9
GREECE                                                                                                        03 SEP 2026



                    Identification                                                        Remarks
                                                        Upper limit
                       Name                                           (time of activity, type of restriction, nature of
                                                        Lower limit
                    Lateral limits                                             hazard, risk of interception)

                           1                                2                                  3
 5.1.3   DANGER AREAS (see also ENR 1.1)
 LGD61                                                                AMC manageable area.
 ZAKINTHOS                                                            Activated by EAUP/EUUP.
                                                                      Firing: Air-to-air, Surface-to-surface, Surface-to-
 373835N 0200024E - 372008N 0205928E -                                air, Air-to-surface.
 365313N 0205638E - 371923N 0195810E -                                Andravida APP has been designated as the
                                                          FL 400
 373835N 0200024E.                                                    authority to grand and issue clearances for
                                                           MSL
                                                                      crossing the area.
                                                                      LGD72B2 not to be activated simultaneously.
                                                                      ATS route affected:
                                                                      AWY A145/UA145 (LORNO-BERAP).


 LGD61Z                                                               AMC manageable area.
                                                                      Activated by EAUP/EUUP.
                                                          FL 415
 375249N 0194905E - 372645N 0211327E -                                For IFR flight planning purposes only.
                                                          FL 295
 363606N 0210731E - 371312N 0194410E -
 375249N 0194905E.
 LGD63                                                                Daily SR-2200 except FRI, SAT, SUN and HOL.
 AMBELON                                                              Firing: Air-to-ground.
                                                          FL 120
                                                                      ATS routes affected:
                                                           GND
 A circle, 5 NM radius centered on                                    a) AWY W58 (VAXUS-KOGIS)
 394500N 0222700E.                                                    b) AWY T6 (VAXUS-KOGIS)
 LGD64                                                                Activated by NOTAM.
 KASSANDRA                                                            Firing: Ground-to-air.
                                                          FL 250
 401430N 0232030E - 401600N 0232000E -                   GND/MSL
 401600N 0232900E - 401000N 0233000E -
 400800N 0232500E - 401430N 0232030E.
 LGD65                                                                Daily 0500-1500, except FRI, SAT, SUN and
 PSATHOURA                                                            HOL.
                                                          FL 250      Firing: Air-to-air, Surface-to-air, Surface-to-
 392600N 0235300E - 394600N 0234000E -                     MSL        surface.
 400030N 0241800E - 394300N 0243100E -
 392600N 0235300E.
 LGD67                                                                Activated by NOTAM.
 NEA PERAMOS                                                          Artillery firing.

 A circle, 2 NM radius centered on
 380300N 0232400E, which is divided into two circular
 segments by a string between the points 380127N
 0232222E and 380355N 0232618E.
 LGD67A NEA PERAMOS
                                                        4000 FT ALT
                                                           GND
 The greater circular segment than the half circle.
 LGD67B NEA PERAMOS
                                                        2000 FT ALT
                                                           GND
 The smaller circular segment than the half circle.
 LGD68                                                                Daily SR-SS.
 ANDROS                                                               Firing: Air-to-Air, Surface-to-Air, Surface-to
                                                                      surface, Air-to-surface.
                                                          FL 250
 381600N 0252100E - 374600N 0254900E -                                AWYs affected:
                                                         GND/MSL
 373400N 0252300E - 374200N 0250100E -                                a) AWY R20/UR20 (KEA-SITRU)
 380000N 0245200E - 380200N 0245200E -                                b) AWY T/UT54 (KEA-SITRU)
 381600N 0252100E.
 LGD69                                                                Activated by NOTAM.
 MESSARA (KRITI ISLAND)                                               Firing: Air-to-air, Surface-to-air.
                                                          FL 250      ATS routes affected:
 350100N 0243600E - 350500N 0243600E -                     MSL        a) AWY R78 (PLH-TIPUS)
 351100N 0241000E - 350600N 0241000E -                                b) AWY M978/UM978 (PLH-TIPUS)
 350100N 0243600E.




HELLENIC AVIATION SERVICE PROVIDER                                                                     AIRAC AMDT 08/26
`;

const ENR52_P1 = String.raw`AIP                                                                                                      ENR 5.2-1
GREECE                                                                                                29 OCT 2026



            ENR 5.2 MILITARY EXERCISE AND TRAINING AREAS AND AIR DEFENCE IDENTIFICATION ZONE



              Identification
                                             Upper limit                          Remarks
                 Name
                                             Lower limit              (time of ACT, risk of interception)
              Lateral limits

                    1                            2                                      3
 5.2.1 TEMPORARY SEGREGATED AREAS

 LGTSA1 TANAGRA                                                 AMC Manageable area.
                                                                Activated via EAUP/EUUP.
 391700N 0215600E - 393400N 0222900E -
 393100N 0223000E - 385300N 0231100E -                          Not to be activated simultaneously with LGTSA2
 385400N 0231500E - 382600N 0231000E -                          or LGTSA6.
 391700N 0215600E.
                                                UNL             Supersonic MIL Flights.
                                               FL 300           Penetration prohibited during activation hours.

                                                                AWYs affected:
                                                                a) UL607 (PIKOS-XORKI)
                                                                b) UN132 (BITLA-ROPOX)
                                                                c) UP20 (ELPIS-ROPOX)
                                                                d) UV651 (YNN-AGH)
                                                                e) UY121 (YNN-AGH)

 LGTSA1Z
                                                                AMC Manageable area.
 391800N 0213400E - 394700N 0223000E -         FL 660           Activated via EAUP/EUUP
 385300N 0232800E - 382200N 0232200E -         FL 285
 381600N 0231600E - 381600N 0230200E -                          For IFR flight planning purposes only.
 391800N 0213400E.

 LGTSA2 ANCHIALOS
                                                                AMC Manageable area.
 392000N 0223200E - 392000N 0231500E -                          Activated via EAUP/EUUP
 391500N 0231800E - 390500N 0231700E -
 390500N 0222600E - 392000N 0223200E.                           Not to be activated simultaneously with LGTSA1.

                                                                Supersonic MIL Flights.
                                                                Penetration prohibited during activation hours.
                                                UNL
                                               FL 290           AWYs affected:
                                                                a) UL607 (PIKOS-XORKI)
                                                                b) UM749 (ELPIS-SKP)
                                                                c) UN132 (BITLA-ROPOX)
                                                                d) UN137 (BITLA-SKP)
                                                                e) UP20 (ELPIS-ROPOX)
                                                                f) UV651 (YNN-AGH)
                                                                g) UY121 (YNN-AGH)

 LGTSA2Z
 393000N 0222300E - 393000N 0232300E -                          AMC Manageable area.
                                               FL 660
 391800N 0233200E - 385500N 0233000E -                          Activated via EAUP/EUUP.
                                               FL 285
 385400N 0221800E - 390600N 0221100E -                          For IFR flight planning purposes only.
 393000N 0222300E.

 LGTSA3 LARISSA                                                 AMC Manageable area.
                                                                Activated via EAUP/EUUP.
 395700N 0222000E - 400500N 0224300E -
 401100N 0224200E - 394600N 0225900E -                          Not to be activated simultaneously with
 392100N 0231100E - 392100N 0224300E -                          LGTSA5 > FL 195.
 392400N 0224800E - 393500N 0223400E -
 395700N 0222000E.                                              Supersonic MIL Flights.
                                                UNL             Penetration prohibited during activation hours.
                                               FL 200
                                                                AWYs affected:
                                                                a) M/UM749 (ELPIS-SKP)
                                                                b) N/UN132 (BITLA-ROPOX)
                                                                c) N/UN137 (BITLA-SKP)
                                                                d) P/UP20 (ELPIS-ROPOX)
                                                                e) W58 (KOGIS-EVIKO)
                                                                f) T6 (KOGIS-EVIKO)




HELLENIC AVIATION SERVICE PROVIDER                                                             AIRAC AMDT 09/26
`;

const ENR53_P1 = String.raw`AIP                                                                                                                    ENR 5.3-1
GREECE                                                                                                               10 JUL 2025



                   ENR 5.3 OTHER ACTIVITIES OF A DANGEROUS NATURE AND OTHER POTENTIAL HAZARDS


5.3.1           Local flying areas



                                                                                  Authority
         Area Identification / Name                           Activity                                   Time of ACT
                                         Vertical limits                       responsible for
         Lateral limits (coordinates)                        Advisory                                      Remarks
                                                                                    INFO
                                                             measures

                      1                         2                 3                   4                         5
AGRINION                                                                                         MON, WED: 0900-SS,
                                                                                                 SAT, SUN and HOL: SR-SS.
383600N 0213400E -383800N 0212600E -      6000 FT ALT        Parachute           AGRINION
384200N 0212900E -384300N 0213400E           GND              jumping             Aeroclub       Permission to cross this area
                                                                                                 during activity may be given
                                                                                                 by AKTION APP.
 ASSIMI                                                                                          This area is used in day time.

 350600N 0250000E - 351700N 0250000E -    6000 FT ALT      Training flights   IRAKION Aeroclub Permission to cross this area
 351300N 0251100E - 350600N 0251100E.      GND / MSL                                           may be given by IRAKLION
                                                                                               APP.
 KALATHOS                                                                                        This area is used in day time.

 361200N 0275830E - 361200N 0281000E -    4000 FT ALT                                            Permission to cross the area
                                                           Training flights   RODOS Aeroclub
 360700N 0281000E - 360700N 0275830E.      GND / MSL                                             during activity may be given
                                                                                                 by DIAGORAS TWR or
                                                                                                 RODOS APP units.
 LACONIA
 LACONIA 1

 370200N 0222900E - 364500N 0223000E -     1000FT ALT
                                                                                                 This area is used on SAT
 364700N 0225300E - 365900N 0224000E.      GND / MSL
                                                                                                 afternoons, SUN and HOL
                                                                                  LACONIA        during day time.
 This area includes LACONIA 2 area.                        Training flights
                                                                                  Aeroclub
                                                                                                 All flights authorised by
 LACONIA 2                                                                                       KALAMATA APP.

 365200N 0223500E - 365200N 0224500E -    3000 FT ALT
 364800N 0224700E - 364800N 0223500E       GND / MSL


 LIMNES
                                                                               THESSALONIKI
 404000N 0231300E - 404000N 0232900E -    3000 FT ALT      Training flights                      Daily for VFR flight.
                                                                                  Aeroclub
 403200N 0232900E - 403500N 0231300E.        GND


 NYMFOPETRA                                                                                      Daily SR-SS.
                                                                                 OLYMPUS
                                                             Aerobatic
404200N 0231416E - 404200N 0231919E -     3000 FT ALT                            AVIATION        Area activated after prior
                                                           Training flights
404007N 0231919E - 404007N 0231416E       2500 FT ALT                            ACADEMY         permission by MAKEDONIA
                                                                                                 APP.
 POLYKASTRO                                                                                      Daily SR-SS.
                                                                                 OLYMPUS
 410117N 0223600E - 410117N 0223900E -    4500 FT ALT        Aerobatic                           Area activated after prior
                                                                                 AVIATION
 405805N 0223900E - 405805N 0223600E.     2500 FT ALT      Training flights                      coordination with
                                                                                 ACADEMY
                                                                                                 KILKIS/NEA KAVALA
                                                                                                 Aeroclub.
 ROPA                                                                                            This area is used in day time.
                                                                                  KERKIRA
 394200N 0194630E - 394230N 0193900E -    2000 FT ALT      Training flights                      Permission to cross the area
                                                                                  Aeroclub
 393700N 0194300E - 393700N 0194730E.      GND / MSL                                             during activity may be given
                                                                                                 by KERKIRA TWR.
SIDARI                                                                                           This area is used in day time.
                                                                                  KERKIRA
395000N 0195100E - 394600N 0193730E -     4500 FT ALT      Training flights                      Permission to cross the area
                                                                                  Aeroclub
394300N 0194330E - 394900N 0195200E.       GND / MSL                                             during activity may be given
                                                                                                 by KERKIRA TWR.




HELLENIC AVIATION SERVICE PROVIDER                                                                           AIRAC AMDT 06/25
`;

// ---- Tests

// ---- Verbatim excerpts (pdftotext -layout) of the AIP SUPs in force at AIRAC 09/26: SUP 09/24 and 01/23 (UFN)
// and the start of SUP 07/26 (time-limited).

const SUP_0924 = String.raw`                                                     AIP GREECE

Tel:        +30 2109972480
Email:      hellas.ais@hasp.gov.gr
AFS:        LGGGYNYP                        MINISTRY OF INFRASTRUCTURE AND TRANSPORT                                AIP SUP       09/24
URL:        https://aisgr.hasp.gov.gr           HELLENIC AVIATION SERVICE PROVIDER                           Effective from:      08 AUG 24
Address:    P.O. BOX 70360               Directorate General of Air Navigation Service Provider                           to:     UFN
            16610 GLYFADA                      Aeronautical Information Service Division                   Publication date:      27 JUN 24

                                                   TEMPORARY RESERVED AREAS

 1. Temporary Reserved Areas are established within ATHINAI FIR as described below:
    1.1. LGTRA1A:          405500N 0253100E – 405400N 0252000E – 405400N 0251000E – 411000N 0245500E –
    411200N 0250700E – 411400N 0254100E – 410700N 0254100E – 410000N 0253300E – 405500N 0253100E.

    1.2. LGTRA1B:          405000N 0254300E – 405200N 0253700E – 405100N 0252800E – 405400N 0252000E –
    405500N 0253100E – 410000N 0253300E – 410700N 0254100E – 405600N 0254700E – 405400N 0254600E –
    405200N 0254600E – 405000N 0254300E.

    1.3. LGTRA1C:          405000N 0254300E – 405200N 0254600E – 405200N 0254900E – 405500N 0255000E –
    405600N 0254700E – 410700N 0254100E – 411400N 0254100E – 411700N 0260900E – 412500N 0261400E –
    414000N 0261200E – 413400N 0262700E – 412700N 0263000E – 412000N 0262700E – 412000N 0261800E –
    410100N 0261200E – 404500N 0255400E – 405000N 0254300E.
 2. Remarks:
    2.1. Army Aviation / UAS Flights.
    2.2. Activation Dates and Times: H24.
    2.3. Vertical Limits: SFC – FL100.
    2.4. When activated, other flights may cross the area after prior permission from the appropriate ATS Unit.
 3. Procedures for unit conducting the activities:
    3.1. Communication with Kavala Approach / Alexandroupolis Tower is required prior to and during the activities.
    3.2. Out of operating hours of Kavala or Alexandroupolis airport, communication with Athinai Control is required prior to and during
    the activities.
 4. Procedures for non-exercise aircraft:
    4.1. In the interest of safety during the exercise, non-exercise aircraft are strongly advised not to fly within the areas designated in
    para 1 above.
`;

const SUP_0123 = String.raw`                                                   AIP GREECE

Tel:       +30 2109972480
Email:     hellas.ais@hasp.gov.gr
AFS:       LGGGYNYP                      MINISTRY OF INFRASTRUCTURE AND TRANSPORT                        AIP SUP     01/23
URL:       https://aisgr.hasp.gov.gr         HELLENIC AVIATION SERVICE PROVIDER                   Effective from:    13 JUL 23
Address:   P.O. BOX 70360              Directorate General of Air Navigation Service Provider                  to:   UFN
           16610 GLYFADA                     Aeronautical Information Service Division          Publication date:    01 JUN 23

                                       HELLENIC AIR FORCE UAV TRAINING FLIGHTS

   1. From 13 JUL 23 UAV training flights will take place within ATHINAI FIR as described below (see also Appendix 1):

           Name and lateral limits                    Upper limit / Lower limit        Remarks (time of activity, type
                                                                                       of restriction, nature of hazard,
                                                                                             risk of interception)
                         1                                          2                                     3
 AREA1                                              10000 FT AMSL/4000FT AMSL          Unmanned Aerial Vehicle flight
                                                                                       operations
 385000N 0242000E - 385000N 0243100E -
 384400N 0243300E - 383900N 0243000E -
                                                                                       Dates and times: 24/7
 383900N 0242300E - 385000N 0242000E

 AREA2                                               7000FT AMSL/4000FT AMSL           SKIROS MTMA/MCTR affected

 385400N 0243900E - 385800N 0244100E -
 385800N 0244600E - 385400N 0244800E -
 384900N 0244600E - 385400N 0243900E

   2. Procedures for participating aircraft:
   -   Participating aircraft shall be in contact with SKIROS APP

   3. Procedures for non participating aircraft:
   -   In the interest of safety during flying activities, non participating aircraft are strongly advised not to fly within
       AREA1 and AREA2
   -   Aircraft unable to avoid the aforementioned areas will be authorized to enter these areas after special permission
       by SKIROS APP
`;

const SUP_0726 = String.raw`                                                 AIP GREECE

Tel:       +30 2109972480
Email:     hellas.ais@hasp.gov.gr
AFS:       LGGGYNYP                      MINISTRY OF INFRASTRUCTURE AND TRANSPORT                         AIP SUP 07/26
URL:       https://aisgr.hasp.gov.gr         HELLENIC AVIATION SERVICE PROVIDER                    Effective from: 11 JUN 26
Address:   P.O. BOX 70360              Directorate General of Air Navigation Service Provider                   to: 09 JUN 27
           16610 GLYFADA                     Aeronautical Information Service Division           Publication date: 30 APR 26

                   TEMPORARY DANGER AREAS (REPLACES AIRAC AIP SUP 05/25)

1.   Temporary Danger Areas, with attached FBZs, are established within ATHINAI FIR/HELLAS UIR as described
     below:

                    Identification                                                                Remarks
                                                            Upper limit
                       Name                                                   (time of activity, type of restriction, nature of
                                                            Lower limit
                    Lateral limits                                                     hazard, risk of interception)
                           1                                     2                                    3
 LGD102A                                                                      AMC manageable area.
                                                                              Activated by EAUP/EUUP.
 353600N 0240700E - 361800N 0240700E -                                        Crossing area is possible under ATC
`;

const byId = (areas: RefArea[]) => new Map(areas.map((a) => [a.id, a]));
const nm = (a: [number, number], b: [number, number]) =>
  Math.hypot((a[0] - b[0]) * 60, (a[1] - b[1]) * 60 * Math.cos((a[0] * Math.PI) / 180));

describe('helpers', () => {
  test('parseCoord', () => {
    expect(parseCoord('375820N 0234333E')).toEqual([37.972222, 23.725833]);
    expect(parseCoord('375323.28N 0234430.84E')).toEqual([37.8898, 23.7419]);
    // Greek capital Nu / Epsilon, as the AIP sometimes prints them.
    expect(parseCoord('365024Ν 0232645Ε')).toEqual([36.84, 23.445833]);
    expect(parseCoord('3758N 02343E')).toEqual([37.966667, 23.716667]);
    expect(parseCoord('LGP1')).toBeNull();
  });

  test('parseLateral', () => {
    expect(parseLateral('A circle, 3 NM centered on 382815N 0222945E.').circle).toEqual({
      lat: 38.470833,
      lon: 22.495833,
      radiusNm: 3,
    });
    expect(parseLateral('A circle, 800 M radius centered on 405722N 0243226E.').circle!.radiusNm).toBeCloseTo(
      800 / 1852,
      4,
    );
    // Open ring is closed; a following target-zone description is ignored.
    const g = parseLateral(
      '374800N 0210500E - 374800N 0211700E- 373100N 0212000E - 373150N 0210800E - 374800N 0210500E. The target zone of above area is a circle, radius 1 KM centred on 374700N 0211430E.',
    );
    expect(g.polygon).toHaveLength(5);
    expect(g.circle).toBeUndefined();
    const open = parseLateral('353200N 0241000E - 353700N 0241000E - 353700N 0241500E - 353200N 0241500E.');
    expect(open.polygon).toHaveLength(5);
    expect(open.polygon![4]).toEqual(open.polygon![0]);
    expect(
      parseLateral(
        '393500N 0224300E - 393600N 0224600E - 392400N 0224600E - 393500N 0224300E excluding STEFANOVIKION ATZ.',
      ).geometryNote,
    ).toMatch(/STEFANOVIKION ATZ/);
  });

  test('normLimit and splitActivity', () => {
    expect(normLimit('FL400')).toBe('FL 400');
    expect(normLimit('1000FT ALT')).toBe('1000 FT ALT');
    expect(normLimit('GND / MSL')).toBe('GND/MSL');
    expect(
      splitActivity([
        'Daily 0500-1500, except FRI, SAT, SUN and',
        'HOL.',
        'Firing: Air-to-air, Surface-to-air, Surface-to-',
        'surface.',
      ]),
    ).toEqual({
      activity: 'Daily 0500-1500, except FRI, SAT, SUN and HOL.',
      remarks: 'Firing: Air-to-air, Surface-to-air, Surface-to-surface.',
    });
  });
});

describe('ENR 5.1', () => {
  const p = byId(parseEnr51([ENR51_P1, ENR51_P3, ENR51_P4, ENR51_P9].join('\n')));

  test('prohibited areas: LGP1 circle in metres, LGP4 polygon', () => {
    expect([...p.keys()].filter((id) => id.startsWith('LGP'))).toEqual([
      'LGP1',
      'LGP4',
      'LGP5',
      'LGP6',
      'LGP7',
      'LGP8',
      'LGP9',
      'LGP10',
      'LGP12',
      'LGP13',
    ]);
    const p1 = p.get('LGP1')!;
    expect(p1).toMatchObject({
      kind: 'P',
      name: 'ACROPOLIS',
      upper: '5000 FT ALT',
      lower: 'GND',
      activity: 'H24',
      source: 'ENR 5.1',
    });
    expect(p1.circle).toEqual({ lat: 37.972222, lon: 23.725833, radiusNm: 0.378 });
    expect(p1.polygon).toBeUndefined();
    expect(p1.lateral).toBe('A circle, 700 M radius centered on 375820N 0234333E.');
    expect(p1.remarks).toBe(
      'Prohibited to all flights.\nArchaeological Monuments protected area.\na) Propeller aircraft above 5000 FT\nb) Jet aircraft above 10000 FT',
    );
    const p4 = p.get('LGP4')!;
    expect(p4).toMatchObject({
      kind: 'P',
      name: 'LAKI (LEROS ISLAND)',
      upper: '3000 FT ALT',
      lower: 'GND/MSL',
      activity: 'H24',
      remarks: 'Prohibited to GAT flights and UAS.',
    });
    expect(p4.polygon).toEqual([
      [37.101111, 26.834722],
      [37.168889, 26.834722],
      [37.102222, 26.851111],
      [37.101111, 26.851111],
      [37.101111, 26.834722],
    ]);
    expect(p.get('LGP7')!.name).toBe('REVYTHOUSSA (FLARESTACK – REVYTHOUSSA ISLAND)');
    expect(p.get('LGP10')!).toMatchObject({
      upper: '5000 FT ALT',
      lower: 'GND',
      circle: { lat: 40.475, lon: 21.338889, radiusNm: 1 },
    });
    expect(p.get('LGP10')!.remarks).toBe('Prohibited to GAT flights and UAS.\nProtection of Fur Farms.');
    // Limits printed beside the second coordinate line.
    expect(p.get('LGP13')!).toMatchObject({ upper: '4000 FT ALT', lower: 'GND' });
    expect(p.get('LGP13')!.polygon).toHaveLength(7);
  });

  test('restricted areas: LGR20 SALAMIS gives only its sub-areas, sharing the remarks', () => {
    expect(p.has('LGR20')).toBe(false);
    const a = p.get('LGR20A')!;
    const b = p.get('LGR20B')!;
    expect(a).toMatchObject({
      kind: 'R',
      group: 'LGR20',
      name: 'SALAMIS',
      upper: '2000 FT ALT',
      lower: 'GND/MSL',
      activity: 'H24',
    });
    expect(b).toMatchObject({
      kind: 'R',
      group: 'LGR20',
      name: 'SALAMIS',
      upper: '1000 FT ALT',
      lower: 'GND/MSL',
      activity: 'H24',
    });
    expect(a.polygon).toHaveLength(6);
    expect(a.polygon![0]).toEqual([37.916667, 23.430556]);
    expect(b.polygon).toEqual([
      [38.025, 23.591667],
      [37.966667, 23.675],
      [37.898611, 23.536111],
      [38.025, 23.591667],
    ]);
    const remarks =
      'Navy.\nAircraft may cross the area from any direction and at any altitude above 2000 FT without restriction, but circling the area at any altitude should be avoided, except for holding over EGN NDB.';
    expect(a.remarks).toBe(remarks);
    expect(b.remarks).toBe(remarks);
    // LGR19's name wraps onto a second line.
    expect(p.get('LGR19')!.name).toBe('MOORING AND LOADING FACILITIES (ANCHORAGE)');
    expect(p.get('LGR14')!.circle!.radiusNm).toBeCloseTo(0.432, 3);
    expect(p.get('LGR17')!.remarks).toContain('The installation is equipped with a helideck, elevation 87 FT AMSL.');
    expect(p.get('LGR22')!).toMatchObject({ activity: 'SR-SS', upper: '5000 FT ALT', lower: 'GND' });
  });

  test('LGR23 sub-areas, LGR24 lower limit above ground, LGR27 multi-line schedule with FL 240', () => {
    expect(p.get('LGR23A')!).toMatchObject({
      group: 'LGR23',
      upper: '5000 FT ALT',
      lower: 'GND/MSL',
      activity: 'SR-SS',
    });
    expect(p.get('LGR23B')!).toMatchObject({ group: 'LGR23', upper: '3000 FT ALT', lower: 'GND' });
    expect(p.get('LGR23A')!.polygon).toHaveLength(8);
    expect(p.get('LGR24')!).toMatchObject({ upper: '5000 FT ALT', lower: '3500 FT ALT', activity: 'SR-SS.' });
    const r27 = p.get('LGR27')!;
    expect(r27).toMatchObject({ kind: 'R', name: 'LITHINON', upper: 'FL 240', lower: 'GND/MSL' });
    expect(r27.activity).toBe('MON 0400 -1200\nTUE, WED, THU 0400-1200 and 1600-2100\nFRI 0400-1200 except HOL');
    expect(r27.remarks).toBe(
      'Training Flights\nATS Routes affected:\na) AWY M978 (TIPUS-OTREX)\nb) AWY R78 (TIPUS-OTREX)',
    );
    expect(r27.polygon).toHaveLength(9);
    expect(r27.polygon![1]).toEqual([34.766667, 24.9]);
    expect(p.get('LGR28')!).toMatchObject({ activity: 'Activated by NOTAM', upper: '1000 FT ALT', lower: 'GND/MSL' });
    expect(p.get('LGR25')!.remarks).toBe(
      'Hellenic Air force \\Training Flights\nThe area is activated under the authorization of TANAGRA APP.',
    );
  });

  test('danger areas: LGD61, its buffer zone LGD61Z, LGD63 circle, LGD65 wrapped schedule', () => {
    const d61 = p.get('LGD61')!;
    expect(d61).toMatchObject({
      kind: 'D',
      name: 'ZAKINTHOS',
      upper: 'FL 400',
      lower: 'MSL',
      activity: 'AMC manageable area.\nActivated by EAUP/EUUP.',
    });
    expect(d61.remarks).toBe(
      'Firing: Air-to-air, Surface-to-surface, Surface-to-air, Air-to-surface.\nAndravida APP has been designated as the authority to grand and issue clearances for crossing the area.\nLGD72B2 not to be activated simultaneously.\nATS route affected:\nAWY A145/UA145 (LORNO-BERAP).',
    );
    expect(d61.polygon).toHaveLength(5);
    const z = p.get('LGD61Z')!;
    expect(z).toMatchObject({
      kind: 'D',
      name: '',
      upper: 'FL 415',
      lower: 'FL 295',
      remarks: 'For IFR flight planning purposes only.',
    });
    expect(z.group).toBeUndefined();
    expect(p.get('LGD63')!).toMatchObject({
      upper: 'FL 120',
      lower: 'GND',
      activity: 'Daily SR-2200 except FRI, SAT, SUN and HOL.',
      circle: { lat: 39.75, lon: 22.45, radiusNm: 5 },
    });
    expect(p.get('LGD65')!.activity).toBe('Daily 0500-1500, except FRI, SAT, SUN and HOL.');
    expect(p.get('LGD65')!.remarks).toBe('Firing: Air-to-air, Surface-to-air, Surface-to-surface.');
  });

  test('LGD67 NEA PERAMOS: circle split by a chord into two segments', () => {
    expect(p.has('LGD67')).toBe(false);
    const big = p.get('LGD67A')!;
    const small = p.get('LGD67B')!;
    expect(big).toMatchObject({
      group: 'LGD67',
      upper: '4000 FT ALT',
      lower: 'GND',
      activity: 'Activated by NOTAM.',
      remarks: 'Artillery firing.',
    });
    expect(small).toMatchObject({ group: 'LGD67', upper: '2000 FT ALT', lower: 'GND' });
    const c: [number, number] = [38.05, 23.4];
    const chordA: [number, number] = [38.024167, 23.372778];
    const chordB: [number, number] = [38.065278, 23.438333];
    for (const seg of [big, small]) {
      const ring = seg.polygon!;
      expect(ring[0]).toEqual(chordA);
      expect(ring[ring.length - 1]).toEqual(chordA);
      expect(ring[ring.length - 2]).toEqual(chordB);
      for (const pt of ring.slice(1, -2)) expect(nm(pt, c)).toBeCloseTo(2, 1);
    }
    // The greater segment holds the centre and goes round the north; the smaller one the south-east.
    expect(Math.max(...big.polygon!.map((q) => q[0]))).toBeGreaterThan(38.08);
    expect(Math.min(...small.polygon!.map((q) => q[0]))).toBeLessThan(38.02);
    expect(big.polygon!.length).toBeGreaterThan(small.polygon!.length);
  });
});

describe('ENR 5.2', () => {
  const p = byId(parseEnr52(ENR52_P1));
  test('TSAs and their buffer zones', () => {
    expect([...p.keys()]).toEqual(['LGTSA1', 'LGTSA1Z', 'LGTSA2', 'LGTSA2Z', 'LGTSA3']);
    const t1 = p.get('LGTSA1')!;
    expect(t1).toMatchObject({ kind: 'MIL', name: 'TANAGRA', upper: 'UNL', lower: 'FL 300', source: 'ENR 5.2' });
    expect(t1.activity).toBe('AMC Manageable area.\nActivated via EAUP/EUUP.');
    expect(t1.remarks).toBe(
      'Not to be activated simultaneously with LGTSA2 or LGTSA6.\nSupersonic MIL Flights.\nPenetration prohibited during activation hours.\nAWYs affected:\na) UL607 (PIKOS-XORKI)\nb) UN132 (BITLA-ROPOX)\nc) UP20 (ELPIS-ROPOX)\nd) UV651 (YNN-AGH)\ne) UY121 (YNN-AGH)',
    );
    expect(t1.polygon).toHaveLength(7);
    expect(t1.polygon![0]).toEqual([39.283333, 21.933333]);
    expect(p.get('LGTSA1Z')!).toMatchObject({
      kind: 'MIL',
      name: '',
      upper: 'FL 660',
      lower: 'FL 285',
      remarks: 'For IFR flight planning purposes only.',
    });
    expect(p.get('LGTSA2')!).toMatchObject({ name: 'ANCHIALOS', upper: 'UNL', lower: 'FL 290' });
    expect(p.get('LGTSA3')!).toMatchObject({ name: 'LARISSA', upper: 'UNL', lower: 'FL 200' });
  });
});

describe('ENR 5.3', () => {
  const p = byId(parseEnr53(ENR53_P1));
  test('local flying areas', () => {
    expect([...p.keys()]).toEqual([
      'AGRINION',
      'ASSIMI',
      'KALATHOS',
      'LACONIA-1',
      'LACONIA-2',
      'LIMNES',
      'NYMFOPETRA',
      'POLYKASTRO',
      'ROPA',
      'SIDARI',
    ]);
    const ag = p.get('AGRINION')!;
    expect(ag).toMatchObject({ kind: 'ACT', name: 'AGRINION', upper: '6000 FT ALT', lower: 'GND', source: 'ENR 5.3' });
    expect(ag.activity).toBe('MON, WED: 0900-SS, SAT, SUN and HOL: SR-SS.');
    expect(ag.remarks).toBe(
      'Parachute jumping\nAuthority: AGRINION Aeroclub\nPermission to cross this area during activity may be given by AKTION APP.',
    );
    expect(ag.polygon).toEqual([
      [38.6, 21.566667],
      [38.633333, 21.433333],
      [38.7, 21.483333],
      [38.716667, 21.566667],
      [38.6, 21.566667],
    ]);
    const l1 = p.get('LACONIA-1')!;
    const l2 = p.get('LACONIA-2')!;
    expect(l1).toMatchObject({ group: 'LACONIA', name: 'LACONIA 1', upper: '1000 FT ALT', lower: 'GND/MSL' });
    expect(l2).toMatchObject({ group: 'LACONIA', name: 'LACONIA 2', upper: '3000 FT ALT', lower: 'GND/MSL' });
    for (const l of [l1, l2]) {
      expect(l.activity).toBe('This area is used on SAT afternoons, SUN and HOL during day time.');
      expect(l.remarks).toBe('Training flights\nAuthority: LACONIA Aeroclub\nAll flights authorised by KALAMATA APP.');
      expect(l.polygon).toHaveLength(5);
    }
    expect(l1.polygon![0]).toEqual([37.033333, 22.483333]);
    expect(l2.polygon![2]).toEqual([36.8, 22.783333]);
    // Authority and remarks columns touch here ('IRAKION Aeroclub Permission …').
    expect(p.get('ASSIMI')!.remarks).toBe(
      'Training flights\nAuthority: IRAKION Aeroclub\nPermission to cross this area may be given by IRAKLION APP.',
    );
    expect(p.get('NYMFOPETRA')!).toMatchObject({
      upper: '3000 FT ALT',
      lower: '2500 FT ALT',
      activity: 'Daily SR-SS.',
    });
  });
});

describe('AIP SUP', () => {
  const run = (sups: [string, string][]) => {
    const warnings: string[] = [];
    const areas = parseSups(new Map(sups), (m) => warnings.push(m));
    return { areas, warnings };
  };
  test('file names and validity', () => {
    expect(supNumber('LG_SUP_A_2024_09_en.txt')).toBe('09/24');
    expect(supNumber('LG_ENR_5_1_en.txt')).toBeNull();
    expect(supValidTo(SUP_0924)).toBe('UFN');
    expect(supValidTo(SUP_0123)).toBe('UFN');
    expect(supValidTo(SUP_0726)).toBe('09 JUN 27');
    expect(supValidTo('Effective date: 10 SEP 2020\n   End Date: UFN')).toBe('UFN');
  });
  test('SUP 09/24 LGTRA1A–C: rings read from the numbered list, limits from the remarks', () => {
    const { areas, warnings } = run([
      ['01/23', SUP_0123],
      ['09/24', SUP_0924],
    ]);
    expect(warnings).toEqual([]);
    const p = byId(areas);
    expect([...p.keys()]).toEqual(['UAV-AREA1', 'UAV-AREA2', 'LGTRA1A', 'LGTRA1B', 'LGTRA1C']);
    const a = p.get('LGTRA1A')!;
    expect(a).toMatchObject({ kind: 'MIL', group: 'LGTRA1', lower: 'SFC', upper: 'FL 100', activity: 'H24' });
    expect(a.source).toBe('AIP SUP 09/24');
    // 9 points printed, the first repeated at the end; the ring stops there, before '1.2. LGTRA1B:'.
    expect(a.polygon).toHaveLength(9);
    expect(a.polygon![0]).toEqual([40.916667, 25.516667]);
    expect(a.polygon![3]).toEqual([41.166667, 24.916667]);
    expect(a.lateral).toMatch(/^405500N 0253100E - 405400N 0252000E - .* - 405500N 0253100E$/);
    expect(p.get('LGTRA1B')!.polygon).toHaveLength(11);
    expect(p.get('LGTRA1C')!.polygon).toHaveLength(17);
    expect(p.get('LGTRA1C')!.polygon![9]).toEqual([41.666667, 26.2]);
  });
  test('SUP 01/23 UAV areas: rings read across the table, limits as printed', () => {
    const p = byId(run([['01/23', SUP_0123]]).areas);
    expect(p.get('UAV-AREA1')!).toMatchObject({ kind: 'MIL', lower: '4000 FT AMSL', upper: '10000 FT AMSL' });
    expect(p.get('UAV-AREA2')!).toMatchObject({ lower: '4000 FT AMSL', upper: '7000 FT AMSL' });
    expect(p.get('UAV-AREA1')!.lateral).toBe(
      '385000N 0242000E - 385000N 0243100E - 384400N 0243300E - 383900N 0243000E - 383900N 0242300E - 385000N 0242000E',
    );
    expect(p.get('UAV-AREA2')!.polygon![2]).toEqual([38.966667, 24.766667]);
  });
  test('a time-limited SUP is reported, not drawn', () => {
    const { areas, warnings } = run([['07/26', SUP_0726]]);
    expect(areas).toEqual([]);
    expect(warnings.some((w) => /07\/26 \(to 09 JUN 27\).*time-limited/.test(w))).toBe(true);
  });
  test('a reissued SUP with other limits, and a SUP gone from the AIP, are flagged', () => {
    const { areas, warnings } = run([['09/24', SUP_0924.replace('SFC – FL100', 'SFC – FL120')]]);
    expect(areas).toEqual([]);
    expect(warnings.filter((w) => /09\/24 LGTRA1.: text changed/.test(w))).toHaveLength(3);
    expect(warnings).toContain('AIP SUP 01/23 is no longer in the AIP: drop it from SUP_AREAS');
  });
  test('a UFN SUP with coordinates and no entry is flagged', () => {
    const { warnings } = run([['99/26', SUP_0924.replace('AIP SUP       09/24', 'AIP SUP       99/26')]]);
    expect(warnings).toContain('AIP SUP 99/26 (UFN) prints coordinates but has no SUP_AREAS entry');
  });
});

describe('tools/enr5_areas.json', () => {
  const areas: RefArea[] = JSON.parse(
    fs.readFileSync(new URL('../../../tools/enr5_areas.json', import.meta.url), 'utf8'),
  );
  test('ids are unique and every area is complete', () => {
    expect(new Set(areas.map((a) => a.id)).size).toBe(areas.length);
    for (const a of areas) {
      expect(a.upper, a.id).toBeTruthy();
      expect(a.lower, a.id).toBeTruthy();
      expect(a.lateral, a.id).toBeTruthy();
      expect(a.source, a.id).toMatch(/^(ENR 5\.[123]|AIP SUP \d{2}\/\d{2})$/);
      expect(!!a.circle || !!a.polygon || !!a.geometryNote, a.id).toBe(true);
    }
  });
  test('geometry is closed and inside Greece', () => {
    const inside = ([lat, lon]: [number, number]) => lat > 33 && lat < 42.5 && lon > 18.5 && lon < 30.5;
    for (const a of areas) {
      if (a.circle) {
        expect(inside([a.circle.lat, a.circle.lon]), a.id).toBe(true);
        expect(a.circle.radiusNm > 0 && a.circle.radiusNm < 20, a.id).toBe(true);
      }
      if (a.polygon) {
        expect(a.polygon.length, a.id).toBeGreaterThanOrEqual(4);
        expect(a.polygon[0], a.id).toEqual(a.polygon[a.polygon.length - 1]);
        for (const pt of a.polygon) expect(inside(pt), `${a.id} ${pt}`).toBe(true);
      }
    }
  });
  test('counts per kind match the AIP designators', () => {
    const n = (f: (a: RefArea) => boolean) => areas.filter(f).length;
    // ENR 5.1.1: LGP1, 4–10, 12–16.
    expect(n((a) => a.kind === 'P')).toBeGreaterThanOrEqual(13);
    // ENR 5.1.2: 43 areas once LGR20/23/29/30/34/46/58 are split into their sub-areas.
    expect(n((a) => a.kind === 'R')).toBeGreaterThanOrEqual(43);
    // ENR 5.1.3: 49 LGD areas (sub-areas and Z buffer zones included); ENR 5.1.4: LGC101 sectors A, A1, A2, B, C.
    expect(n((a) => a.kind === 'D' && a.id.startsWith('LGD'))).toBeGreaterThanOrEqual(49);
    expect(areas.filter((a) => a.group === 'LGC101').map((a) => a.id)).toEqual([
      'LGC101A',
      'LGC101A1',
      'LGC101A2',
      'LGC101B',
      'LGC101C',
    ]);
    // ENR 5.2.1: LGTSA1–7 and their Z buffer zones.
    expect(n((a) => a.kind === 'MIL')).toBeGreaterThanOrEqual(14);
    // ENR 5.3.1: 10 entries, LACONIA as LACONIA 1 and 2.
    expect(n((a) => a.kind === 'ACT')).toBeGreaterThanOrEqual(11);
  });
  test('AIP order: 5.1 P, R, D, then 5.2, then 5.3, then the SUPs', () => {
    const rank = (a: RefArea) => (a.source.startsWith('AIP SUP') ? 5 : { P: 0, R: 1, D: 2, MIL: 3, ACT: 4 }[a.kind]);
    for (let i = 1; i < areas.length; i++) expect(rank(areas[i]) >= rank(areas[i - 1]), areas[i].id).toBe(true);
  });
  test('the areas of the UFN SUPs in force (SUP 01/23, 09/24) are drawn', () => {
    const sup = areas.filter((a) => a.source.startsWith('AIP SUP')).map((a) => `${a.source} ${a.id}`);
    expect(sup).toEqual([
      'AIP SUP 01/23 UAV-AREA1',
      'AIP SUP 01/23 UAV-AREA2',
      'AIP SUP 09/24 LGTRA1A',
      'AIP SUP 09/24 LGTRA1B',
      'AIP SUP 09/24 LGTRA1C',
    ]);
  });
  test('spot checks on the full text', () => {
    const p = byId(areas);
    expect(p.get('LGD77')!).toMatchObject({ upper: 'FL 290', lower: 'GND' });
    expect(p.get('LGD77')!.activity).toBe(
      'FL 140: Daily SR-1300 and SS-21 00 except FRI, SAT, SUN and HOL.\nFL 290: Every WED, THU 0530-0730 except HOL.',
    );
    expect(p.get('LGR30A')!.polygon![0]).toEqual([38.25, 22.2]);
    expect(p.get('LGD83Z')!.polygon![0]).toEqual([36.84, 23.445833]);
    expect(p.get('LGR34W')!.geometryNote).toMatch(/STEFANOVIKION ATZ/);
    expect(p.get('TRIPOLIS')!).toMatchObject({
      upper: 'FL 170',
      lower: 'FL 120',
      activity: 'Daily SR-SS except SAT, SUN and HOL.',
    });
    expect(p.get('LGTSA6')!).toMatchObject({ upper: 'FL 400', lower: 'FL 305' });
    // ENR 5.1 (unchanged through AIRAC 07/26–09/26) puts PETROKARAVO by the islet off Hydra, as AD 2-LGAV-VFR
    // draws it; AD 2-LGPA-VFR (AMDT 02/25) draws a box of the same size west of Sifnos, a chart error.
    expect(p.get('LGD85')!).toMatchObject({ name: 'PETROKARAVO', lower: 'MSL', upper: '1000 FT ALT' });
    expect(p.get('LGD85')!.polygon![0]).toEqual([37.366667, 23.583333]);
  });
});

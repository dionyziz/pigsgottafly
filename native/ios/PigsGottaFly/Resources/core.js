// STUB core.js, hand-written so that the native app builds and runs until the real one lands.
// The real file is built by `npm run native:core` from src/native/core.ts and REPLACES this one at
// the same path (native/ios/PigsGottaFly/Resources/core.js). Contract: NATIVE.md "core.js API".
//
// Everything here is deliberately simple: great-circle legs at the aircraft's cruise TAS with no
// wind, a fixed 5°E variation, a chart with a handful of layers. Do not fix numbers here: fix them
// in the TypeScript core.
//
// Shapes the app reads (the real core should return at least these fields):
//   computeFlight → { legs: [{ index, from, to, key }], navlog: NavlogResult (legs[].altFt, mh|mc,
//     dist, gs, ete, fuel, startMin, endMin, tasKt; totals; times; sunsetMin), fuel, wb, warnings,
//     readiness: ReadyItem[] ({ id, stage, state, label, text }), times: { blockOff, takeoff, landing,
//     blockOn, sunset ('HH:MM' or null), aerodromes: [{ id, name, role, hours, handling }] } }
//   paperwork → ReadyItem[]
//   progress  → { legIndex, toWaypoint, distNm, bearingDeg, crossTrackNm, eteMin, eta (epoch ms),
//     plannedAltFt, plannedHdg, freq, nextFreq ({ callsign, mhz } or null), offRoute }
/* eslint-disable */
(function (global) {
  'use strict';

  var VERSION = 'stub-0.1';
  var VARIATION_E = 5; // degrees east, fixed in the stub

  var CHART = {
    aerodrome: '#1d3f8f',
    navaid: '#0e5a78',
    tma: '#2f64c0',
    zone: '#b4235a',
    fis: '#6b7480',
    prohibited: '#b71c1c',
    restricted: '#c62828',
    danger: '#b45309',
    vfr: '#1e6b46',
    waypoint: '#7a3db8',
    route: '#c2185b',
    paper: '#ffffff',
  };

  var SOURCES = [
    'airspaces',
    'zones',
    'areas',
    'fir',
    'vfr-routes',
    'vfr-route-arrows',
    'vfr-points',
    'navaids',
    'aerodromes',
    'waypoints',
    'air-focus',
    'route-line',
    'leg-focus',
    'route-arrows',
    'route-band',
    'route-mid',
    'route-points',
    'snap',
  ];

  var SYMBOLS = [
    'pgf-ad-major',
    'pgf-ad-minor',
    'pgf-ad-plain',
    'pgf-ad-water',
    'pgf-vfr',
    'pgf-vfr-ofm',
    'pgf-wpt',
    'pgf-nav-vor',
    'pgf-nav-vordme',
    'pgf-nav-vortac',
    'pgf-nav-tacan',
    'pgf-nav-dme',
    'pgf-nav-ndb',
    'pgf-nav-l',
    'pgf-arrow',
    'pgf-route-arrow',
    'pgf-hatch-r',
  ];

  var GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  var FONT = ['Noto Sans Regular'];
  var BOLD = ['Noto Sans Bold'];

  // ------------------------------------------------------------------ geometry
  var R_NM = 3440.065;
  var rad = function (d) {
    return (d * Math.PI) / 180;
  };
  var deg = function (r) {
    return (r * 180) / Math.PI;
  };
  var norm360 = function (d) {
    return ((d % 360) + 360) % 360;
  };
  function distNm(a, b) {
    var dLat = rad(b.lat - a.lat),
      dLon = rad(b.lon - a.lon);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function bearing(a, b) {
    var y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    var x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return norm360(deg(Math.atan2(y, x)));
  }
  function circle(lat, lon, radiusNm) {
    var ring = [];
    for (var i = 0; i <= 48; i++) {
      var a = (i / 48) * 2 * Math.PI;
      ring.push([lon + ((radiusNm / 60) * Math.sin(a)) / Math.cos(rad(lat)), lat + (radiusNm / 60) * Math.cos(a)]);
    }
    return [ring];
  }
  var lonLat = function (p) {
    return [p[1], p[0]];
  };
  function polygonOf(rec) {
    if (rec.circle) return circle(rec.circle.lat, rec.circle.lon, rec.circle.radiusNm);
    if (rec.polygon && rec.polygon.length > 2) {
      var ring = rec.polygon.map(lonLat);
      ring.push(ring[0]);
      return [ring];
    }
    return null;
  }
  var fc = function (features) {
    return { type: 'FeatureCollection', features: features };
  };
  var point = function (lon, lat, props) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props || {} };
  };

  // ------------------------------------------------------------------ chart
  function chartLayers() {
    return [
      { id: 'pgf-fir', type: 'line', source: 'fir', paint: { 'line-color': CHART.fis, 'line-width': 1.5, 'line-dasharray': [4, 2] } },
      { id: 'pgf-airspaces-fill', type: 'fill', source: 'airspaces', paint: { 'fill-color': CHART.tma, 'fill-opacity': 0.05 } },
      { id: 'pgf-airspaces', type: 'line', source: 'airspaces', paint: { 'line-color': CHART.tma, 'line-width': 1.4 } },
      { id: 'pgf-zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': CHART.zone, 'fill-opacity': 0.06 } },
      { id: 'pgf-zones', type: 'line', source: 'zones', paint: { 'line-color': CHART.zone, 'line-width': 1.2, 'line-dasharray': [3, 2] } },
      { id: 'pgf-areas-hatch', type: 'fill', source: 'areas', filter: ['==', ['get', 'kind'], 'R'], paint: { 'fill-pattern': 'pgf-hatch-r' } },
      {
        id: 'pgf-areas',
        type: 'line',
        source: 'areas',
        paint: {
          'line-color': ['match', ['get', 'kind'], 'P', CHART.prohibited, 'R', CHART.restricted, CHART.danger],
          'line-width': 1.2,
        },
      },
      { id: 'pgf-vfr-routes', type: 'line', source: 'vfr-routes', paint: { 'line-color': CHART.vfr, 'line-width': 1.2, 'line-dasharray': [2, 2] } },
      { id: 'pgf-route-casing', type: 'line', source: 'route-line', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': CHART.paper, 'line-width': 7 } },
      { id: 'pgf-route', type: 'line', source: 'route-line', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': CHART.route, 'line-width': 4 } },
      {
        id: 'pgf-route-arrows',
        type: 'symbol',
        source: 'route-arrows',
        layout: { 'icon-image': 'pgf-route-arrow', 'icon-rotate': ['get', 'bearing'], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true },
      },
      {
        id: 'pgf-vfr-points',
        type: 'symbol',
        source: 'vfr-points',
        minzoom: 8,
        layout: {
          'icon-image': 'pgf-vfr',
          'text-field': ['get', 'name'],
          'text-font': FONT,
          'text-size': 11,
          'text-offset': [0, 1.1],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': CHART.vfr, 'text-halo-color': CHART.paper, 'text-halo-width': 1.5 },
      },
      {
        id: 'pgf-navaids',
        type: 'symbol',
        source: 'navaids',
        layout: {
          'icon-image': ['get', 'icon'],
          'text-field': ['get', 'ident'],
          'text-font': BOLD,
          'text-size': 11,
          'text-offset': [0, 1.3],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': CHART.navaid, 'text-halo-color': CHART.paper, 'text-halo-width': 1.5 },
      },
      {
        id: 'pgf-aerodromes',
        type: 'symbol',
        source: 'aerodromes',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-allow-overlap': true,
          'text-field': ['get', 'label'],
          'text-font': BOLD,
          'text-size': 12,
          'text-offset': [0, 1.4],
          'text-anchor': 'top',
          'text-optional': true,
        },
        paint: { 'text-color': CHART.aerodrome, 'text-halo-color': CHART.paper, 'text-halo-width': 1.5 },
      },
      {
        id: 'pgf-route-points',
        type: 'circle',
        source: 'route-points',
        paint: { 'circle-radius': 5, 'circle-color': CHART.paper, 'circle-stroke-color': CHART.route, 'circle-stroke-width': 2.5 },
      },
      {
        id: 'pgf-route-labels',
        type: 'symbol',
        source: 'route-points',
        layout: { 'text-field': ['get', 'name'], 'text-font': BOLD, 'text-size': 13, 'text-offset': [0, -1.3], 'text-anchor': 'bottom' },
        paint: { 'text-color': CHART.route, 'text-halo-color': CHART.paper, 'text-halo-width': 2 },
      },
    ];
  }

  function chartStyle(input) {
    var vector = input && input.vector;
    var style;
    if (vector && vector.version === 8 && Array.isArray(vector.layers)) {
      style = JSON.parse(JSON.stringify(vector));
      style.glyphs = style.glyphs || GLYPHS;
    } else {
      style = {
        version: 8,
        glyphs: GLYPHS,
        sources: {
          base: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [
          { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
          { id: 'base', type: 'raster', source: 'base' },
        ],
      };
    }
    for (var i = 0; i < SOURCES.length; i++) style.sources[SOURCES[i]] = { type: 'geojson', data: fc([]) };
    style.layers = style.layers.concat(chartLayers());
    return style;
  }

  function adIcon(a) {
    if (a.water) return 'pgf-ad-water';
    if (a.icao && a.runways && a.runways.length) return 'pgf-ad-major';
    if (a.runways && a.runways.length) return 'pgf-ad-minor';
    return 'pgf-ad-plain';
  }
  function navIcon(t) {
    switch (t) {
      case 'VOR':
        return 'pgf-nav-vor';
      case 'VOR/DME':
        return 'pgf-nav-vordme';
      case 'VORTAC':
        return 'pgf-nav-vortac';
      case 'TACAN':
        return 'pgf-nav-tacan';
      case 'DME':
        return 'pgf-nav-dme';
      case 'L':
        return 'pgf-nav-l';
      default:
        return 'pgf-nav-ndb';
    }
  }

  function chartData(input) {
    var ref = (input && input.ref) || {};
    var flight = input && input.flight;
    var out = {};
    for (var i = 0; i < SOURCES.length; i++) out[SOURCES[i]] = fc([]);
    out.aerodromes = fc(
      (ref.aerodromes || []).map(function (a) {
        return point(a.lon, a.lat, { id: a.id, label: a.icao || a.name, icon: adIcon(a) });
      }),
    );
    out['vfr-points'] = fc(
      (ref.vfrPoints || []).map(function (p) {
        return point(p.lon, p.lat, { id: p.id, name: p.name });
      }),
    );
    out.navaids = fc(
      (ref.navaids || []).map(function (n) {
        return point(n.lon, n.lat, { id: n.id, ident: n.ident, icon: navIcon(n.type) });
      }),
    );
    var polys = function (list) {
      var f = [];
      (list || []).forEach(function (r) {
        var g = polygonOf(r);
        if (g) f.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: g }, properties: { id: r.id, name: r.name, kind: r.kind } });
      });
      return fc(f);
    };
    out.airspaces = polys(ref.airspaces);
    out.zones = polys(ref.adAirspaces);
    out.areas = polys(ref.areas);
    if (ref.fir && ref.fir.boundary)
      out.fir = fc([{ type: 'Feature', geometry: { type: 'LineString', coordinates: ref.fir.boundary.map(lonLat) }, properties: {} }]);
    var byName = {};
    (ref.vfrPoints || []).forEach(function (p) {
      byName[p.chart + ':' + p.name] = p;
    });
    var vr = [];
    (ref.vfrRoutes || []).forEach(function (r) {
      var a = byName[r.chart + ':' + r.a],
        b = byName[r.chart + ':' + r.b];
      if (a && b)
        vr.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }, properties: { id: r.id } });
    });
    out['vfr-routes'] = fc(vr);
    var route = (flight && flight.route) || [];
    if (route.length > 1) {
      out['route-line'] = fc([
        {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: route.map(function (p) {
              return [p.lon, p.lat];
            }),
          },
          properties: {},
        },
      ]);
      var arrows = [];
      for (var j = 0; j + 1 < route.length; j++) {
        var a = route[j],
          b = route[j + 1];
        arrows.push(point((a.lon + b.lon) / 2, (a.lat + b.lat) / 2, { leg: j, bearing: bearing(a, b) }));
      }
      out['route-arrows'] = fc(arrows);
    }
    out['route-points'] = fc(
      route.map(function (p, k) {
        return point(p.lon, p.lat, { uid: p.uid, name: p.name, index: k });
      }),
    );
    return out;
  }

  // ------------------------------------------------------------------ weather
  function weatherRequests(input) {
    var route = (input && input.flight && input.flight.route) || [];
    var ids = [];
    route.forEach(function (p) {
      if (p.kind === 'aerodrome' && p.refId && /^[A-Z]{4}$/.test(p.refId) && ids.indexOf(p.refId) < 0) ids.push(p.refId);
    });
    var alts = (input && input.flight && input.flight.options && input.flight.options.alternates) || [];
    alts.forEach(function (a) {
      if (ids.indexOf(a) < 0) ids.push(a);
    });
    return ids.length ? ['weather/metar?ids=' + ids.join(',')] : [];
  }

  // ------------------------------------------------------------------ flight
  var pad = function (n) {
    return (n < 10 ? '0' : '') + n;
  };
  function clock(min) {
    if (min == null || !isFinite(min)) return null;
    var m = Math.round(min);
    m = ((m % 1440) + 1440) % 1440;
    return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
  }
  function parseClock(s) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
    return m ? +m[1] * 60 + +m[2] : NaN;
  }
  // NOAA-free approximation: sunset in Greece in late November ≈ 15:10Z, mid-summer ≈ 17:50Z
  function sunsetMin(date) {
    var d = new Date((date || '2026-06-21') + 'T00:00:00Z');
    var doy = Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5);
    return Math.round(16.5 * 60 + 80 * Math.sin((2 * Math.PI * (doy - 80)) / 365));
  }

  function computeFlight(input) {
    var flight = input.flight || {};
    var aircraft = input.aircraft || null;
    var ref = input.ref || {};
    var route = flight.route || [];
    var overrides = flight.legOverrides || {};
    var tas = (aircraft && aircraft.cruiseTasKt) || 100;
    var burn = (aircraft && aircraft.fuel && aircraft.fuel.burnLph) || 30;
    var allowance = (aircraft && aircraft.fuel && aircraft.fuel.taxiAllowanceL) || 4;
    var bo = parseClock(flight.blockOff);
    var blockOffSet = isFinite(bo);
    if (!blockOffSet) bo = 12 * 60;
    var t = bo + (flight.taxiOutMin || 0);
    var takeoff = t;
    var legs = [],
      rows = [],
      dist = 0,
      ete = 0,
      trip = 0;
    for (var i = 0; i + 1 < route.length; i++) {
      var a = route[i],
        b = route[i + 1];
      var key = a.uid + '>' + b.uid;
      var tc = Math.round(bearing(a, b));
      var d = distNm(a, b);
      var ov = overrides[key] || {};
      var alt = ov.altFt != null ? ov.altFt : i === 0 || i + 2 === route.length ? 3500 : 4500;
      var legTas = ov.tasKt || tas;
      var exact = (d / legTas) * 60;
      var legEte = Math.max(1, Math.round(exact));
      var fuel = Math.ceil((legEte / 60) * burn);
      var mc = norm360(tc - VARIATION_E) || 360;
      legs.push({ index: i, from: a.name, to: b.name, fromUid: a.uid, toUid: b.uid, key: key, tc: tc, dist: d });
      rows.push({
        index: i,
        altFt: alt,
        tasKt: legTas,
        tc: tc,
        dist: Math.round(d),
        windDirDeg: NaN,
        windKt: NaN,
        tempC: NaN,
        windMissing: true,
        windSource: 'none',
        wca: 0,
        th: tc,
        var: -VARIATION_E,
        mc: mc,
        mh: mc,
        gs: legTas,
        minutesExact: exact,
        ete: legEte,
        fuel: fuel,
        variation: VARIATION_E,
        startMin: t,
        endMin: t + exact,
      });
      t += exact;
      dist += Math.round(d);
      ete += legEte;
      trip += fuel;
    }
    var landing = t;
    var blockOn = landing + (flight.taxiInMin || 0);
    var sunset = sunsetMin(flight.date);
    var totals = { dist: dist, ete: ete, tripFuel: trip, fuel: trip + allowance };
    var navlog = {
      legs: rows,
      totals: totals,
      times: { blockOffMin: bo, takeoffMin: takeoff, landingMin: landing, blockOnMin: blockOn },
      flightMin: landing - takeoff,
      circuits: [],
      blockOffSet: blockOffSet,
      sunsetMin: sunset,
      warnings: ['Stub core: winds are not applied.'],
      legWarnings: [],
    };
    var usable = (aircraft && aircraft.fuel && aircraft.fuel.usableL) || 0;
    var fob = flight.fobL != null ? flight.fobL : Math.min(usable || Infinity, totals.fuel + Math.round((45 / 60) * burn));
    var warnings = [{ level: 'info', area: 'navlog', text: 'Stub core: winds are not applied.' }];
    if (!blockOffSet) warnings.push({ level: 'warn', area: 'when', text: 'Block-off time not set.' });
    if (landing > sunset - 30) warnings.push({ level: 'warn', area: 'when', text: 'Landing within 30 minutes of sunset.' });

    var adById = {};
    (ref.aerodromes || []).forEach(function (x) {
      adById[x.id] = x;
      if (x.icao) adById[x.icao] = x;
    });
    var adRows = [];
    var addAd = function (id, role) {
      var x = id && adById[id];
      if (!x) return;
      var h = x.hours || {};
      adRows.push({
        id: x.id,
        icao: x.icao,
        name: x.name,
        role: role,
        hours: (h.ad && h.ad.parsed && h.ad.parsed.label) || (h.ad && h.ad.text) || 'Unknown',
        handling: (h.handling && h.handling.parsed && h.handling.parsed.label) || null,
      });
    };
    if (route.length) addAd(route[0].refId || route[0].name, 'departure');
    if (route.length > 1) addAd(route[route.length - 1].refId || route[route.length - 1].name, 'destination');
    ((flight.options && flight.options.alternates) || []).forEach(function (x) {
      addAd(x, 'alternate');
    });

    var row = function (id, stage, state, label, text, section) {
      return { id: id, stage: stage, state: state, label: label, text: text, warning: null, section: section };
    };
    var readiness = [
      row('route', 'plan', route.length > 1 ? 'ok' : 'todo', 'Route', route.length > 1 ? null : 'Add the destination.', 'route'),
      row('aircraft', 'plan', aircraft ? 'ok' : 'todo', 'Aircraft', aircraft ? null : 'Choose the aircraft.', 'aircraft'),
      row('navlog', 'plan', 'ok', 'Navlog and altitudes', null, 'route'),
      row('fuel', 'plan', fob >= totals.fuel ? 'ok' : 'danger', 'Fuel', fob >= totals.fuel ? null : 'Not enough fuel on board.', 'fuel'),
      row('wb', 'plan', 'ok', 'Weight and balance', null, 'manifest'),
      row(
        'daylight',
        'brief',
        landing > sunset - 30 ? 'warn' : 'ok',
        'Times and daylight',
        landing > sunset - 30 ? 'Landing within 30 minutes of sunset.' : null,
        'when',
      ),
      row('weather', 'brief', 'ok', 'Weather', null, 'metar'),
    ];
    return {
      legs: legs,
      navlog: navlog,
      fuel: { requiredL: totals.fuel, fobL: fob, burnLph: burn, enduranceMin: Math.round((fob / burn) * 60) },
      wb: { ok: true },
      warnings: warnings,
      readiness: readiness,
      times: {
        date: flight.date,
        blockOff: clock(bo),
        takeoff: clock(takeoff),
        landing: clock(landing),
        blockOn: clock(blockOn),
        sunset: clock(sunset),
        aerodromes: adRows,
      },
    };
  }

  function paperwork(input) {
    var filing = input && input.filing;
    var forms = input && input.forms;
    var decl = input && input.declarations;
    var st = filing && filing.filing ? filing.filing.status : 'not-filed';
    var filed = ['filed', 'departed', 'arriving', 'arrived', 'closed'].indexOf(st) >= 0;
    var rows = [
      {
        id: 'fpl',
        stage: 'file',
        state: filed ? 'ok' : 'todo',
        label: 'Flight plan',
        text: filed ? null : 'File the flight plan.',
        warning: null,
        section: 'fpl',
      },
    ];
    if (forms && forms.form731) {
      var sent = !!forms.form731.submission;
      rows.push({
        id: 'form731',
        stage: 'file',
        state: sent ? 'ok' : 'todo',
        label: 'Form 731',
        text: sent ? null : forms.form731.allSigned ? 'Send Form 731.' : 'Waiting for signatures.',
        warning: null,
        section: 'fpl',
      });
    }
    if (forms && forms.gendec && forms.gendec.pilotSends) {
      var gs = !!forms.gendec.submission;
      rows.push({ id: 'gendec', stage: 'file', state: gs ? 'ok' : 'todo', label: 'General Declaration', text: gs ? null : 'Send the General Declaration.', warning: null, section: 'fpl' });
    }
    if (decl && decl.operator && decl.operator.requiresWbPerf) {
      var ds = !!decl.submission;
      rows.push({ id: 'wbperf', stage: 'file', state: ds ? 'ok' : 'todo', label: 'W&B and performance to the operator', text: ds ? null : 'Send the sheets.', warning: null, section: 'fpl' });
    }
    return rows;
  }

  // ------------------------------------------------------------------ progress
  function progress(input) {
    var flight = input.flight || {};
    var computed = input.computed || {};
    var pos = input.position || {};
    var route = flight.route || [];
    var rows = (computed.navlog && computed.navlog.legs) || [];
    if (route.length < 2) return null;
    var p = { lat: pos.lat, lon: pos.lon };
    var k = Math.cos(rad(p.lat));
    var best = 0,
      bestD = Infinity,
      bestT = 0;
    for (var i = 0; i + 1 < route.length; i++) {
      var a = route[i],
        b = route[i + 1];
      var ax = (b.lon - a.lon) * k,
        ay = b.lat - a.lat;
      var px = (p.lon - a.lon) * k,
        py = p.lat - a.lat;
      var len2 = ax * ax + ay * ay || 1e-12;
      var t = Math.max(0, Math.min(1, (px * ax + py * ay) / len2));
      var dx = px - t * ax,
        dy = py - t * ay;
      var d = Math.sqrt(dx * dx + dy * dy) * 60;
      if (d < bestD - 1e-9) {
        bestD = d;
        best = i;
        bestT = t;
      }
    }
    if (bestT >= 0.999 && best + 2 < route.length) best++;
    var from = route[best],
      to = route[best + 1];
    var legBrg = bearing(from, to);
    var toWp = distNm(p, to);
    var brgFromStart = bearing(from, p);
    var xtk = distNm(from, p) * Math.sin(rad(brgFromStart - legBrg));
    var row = rows[best] || {};
    var gs = pos.gsKt && pos.gsKt > 20 ? pos.gsKt : row.gs || row.tasKt || 100;
    var eteMin = (toWp / gs) * 60;
    var atc = flight.atc || [];
    var find = function (role) {
      for (var j = 0; j < atc.length; j++) if (atc[j].role === role) return { callsign: atc[j].callsign, mhz: atc[j].primary };
      return null;
    };
    var last = best + 2 >= route.length;
    var freq = best === 0 ? find('departure') : last ? find('destination') : find('fis') || find('airspace');
    var nextFreq = best === 0 ? find('fis') || find('destination') : last ? null : best + 3 >= route.length ? find('destination') : find('fis');
    return {
      legIndex: best,
      toWaypoint: to.name,
      distNm: toWp,
      bearingDeg: bearing(p, to),
      crossTrackNm: xtk,
      eteMin: eteMin,
      eta: (pos.time || Date.now()) + eteMin * 60000,
      plannedAltFt: row.altFt != null ? row.altFt : null,
      plannedHdg: row.mh != null ? row.mh : row.mc != null ? row.mc : null,
      freq: freq,
      nextFreq: nextFreq,
      offRoute: Math.abs(xtk) > 2,
    };
  }

  global.PGF = {
    version: VERSION,
    stub: true,
    symbolNames: function () {
      return SYMBOLS.slice();
    },
    chartStyle: chartStyle,
    chartData: chartData,
    weatherRequests: weatherRequests,
    computeFlight: computeFlight,
    paperwork: paperwork,
    progress: progress,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

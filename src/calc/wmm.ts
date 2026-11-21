// Magnetic variation from the World Magnetic Model WMM2025 (NOAA NCEI / BGS, valid 2025.0-2030.0).
//
// Spherical-harmonic synthesis to degree and order 12 with the official WMM2025 coefficients
// (WMM2025.COF, released 2024-11-13, embedded verbatim below), following the WMM2025 Technical
// Report: geodetic -> geocentric spherical coordinates on WGS 84, Schmidt semi-normalised associated
// Legendre functions, field rotated back to the geodetic frame. Unit-tested against every one of the
// 100 official test values (WMM2025_TestValues.txt) in tests/unit/calc/wmm.test.ts.
import type { IsoDate } from '../shared/types.js';

export const WMM_EPOCH = 2025.0;
export const WMM_VALID_UNTIL = 2030.0;

// WMM2025.COF: n, m, g, h (nT), g-dot, h-dot (nT/year) at epoch 2025.0.
const COF = `
  1  0  -29351.8       0.0       12.0        0.0
  1  1   -1410.8    4545.4        9.7      -21.5
  2  0   -2556.6       0.0      -11.6        0.0
  2  1    2951.1   -3133.6       -5.2      -27.7
  2  2    1649.3    -815.1       -8.0      -12.1
  3  0    1361.0       0.0       -1.3        0.0
  3  1   -2404.1     -56.6       -4.2        4.0
  3  2    1243.8     237.5        0.4       -0.3
  3  3     453.6    -549.5      -15.6       -4.1
  4  0     895.0       0.0       -1.6        0.0
  4  1     799.5     278.6       -2.4       -1.1
  4  2      55.7    -133.9       -6.0        4.1
  4  3    -281.1     212.0        5.6        1.6
  4  4      12.1    -375.6       -7.0       -4.4
  5  0    -233.2       0.0        0.6        0.0
  5  1     368.9      45.4        1.4       -0.5
  5  2     187.2     220.2        0.0        2.2
  5  3    -138.7    -122.9        0.6        0.4
  5  4    -142.0      43.0        2.2        1.7
  5  5      20.9     106.1        0.9        1.9
  6  0      64.4       0.0       -0.2        0.0
  6  1      63.8     -18.4       -0.4        0.3
  6  2      76.9      16.8        0.9       -1.6
  6  3    -115.7      48.8        1.2       -0.4
  6  4     -40.9     -59.8       -0.9        0.9
  6  5      14.9      10.9        0.3        0.7
  6  6     -60.7      72.7        0.9        0.9
  7  0      79.5       0.0       -0.0        0.0
  7  1     -77.0     -48.9       -0.1        0.6
  7  2      -8.8     -14.4       -0.1        0.5
  7  3      59.3      -1.0        0.5       -0.8
  7  4      15.8      23.4       -0.1        0.0
  7  5       2.5      -7.4       -0.8       -1.0
  7  6     -11.1     -25.1       -0.8        0.6
  7  7      14.2      -2.3        0.8       -0.2
  8  0      23.2       0.0       -0.1        0.0
  8  1      10.8       7.1        0.2       -0.2
  8  2     -17.5     -12.6        0.0        0.5
  8  3       2.0      11.4        0.5       -0.4
  8  4     -21.7      -9.7       -0.1        0.4
  8  5      16.9      12.7        0.3       -0.5
  8  6      15.0       0.7        0.2       -0.6
  8  7     -16.8      -5.2       -0.0        0.3
  8  8       0.9       3.9        0.2        0.2
  9  0       4.6       0.0       -0.0        0.0
  9  1       7.8     -24.8       -0.1       -0.3
  9  2       3.0      12.2        0.1        0.3
  9  3      -0.2       8.3        0.3       -0.3
  9  4      -2.5      -3.3       -0.3        0.3
  9  5     -13.1      -5.2        0.0        0.2
  9  6       2.4       7.2        0.3       -0.1
  9  7       8.6      -0.6       -0.1       -0.2
  9  8      -8.7       0.8        0.1        0.4
  9  9     -12.9      10.0       -0.1        0.1
 10  0      -1.3       0.0        0.1        0.0
 10  1      -6.4       3.3        0.0        0.0
 10  2       0.2       0.0        0.1       -0.0
 10  3       2.0       2.4        0.1       -0.2
 10  4      -1.0       5.3       -0.0        0.1
 10  5      -0.6      -9.1       -0.3       -0.1
 10  6      -0.9       0.4        0.0        0.1
 10  7       1.5      -4.2       -0.1        0.0
 10  8       0.9      -3.8       -0.1       -0.1
 10  9      -2.7       0.9       -0.0        0.2
 10 10      -3.9      -9.1       -0.0       -0.0
 11  0       2.9       0.0        0.0        0.0
 11  1      -1.5       0.0       -0.0       -0.0
 11  2      -2.5       2.9        0.0        0.1
 11  3       2.4      -0.6        0.0       -0.0
 11  4      -0.6       0.2        0.0        0.1
 11  5      -0.1       0.5       -0.1       -0.0
 11  6      -0.6      -0.3        0.0       -0.0
 11  7      -0.1      -1.2       -0.0        0.1
 11  8       1.1      -1.7       -0.1       -0.0
 11  9      -1.0      -2.9       -0.1        0.0
 11 10      -0.2      -1.8       -0.1        0.0
 11 11       2.6      -2.3       -0.1        0.0
 12  0      -2.0       0.0        0.0        0.0
 12  1      -0.2      -1.3        0.0       -0.0
 12  2       0.3       0.7       -0.0        0.0
 12  3       1.2       1.0       -0.0       -0.1
 12  4      -1.3      -1.4       -0.0        0.1
 12  5       0.6      -0.0       -0.0       -0.0
 12  6       0.6       0.6        0.1       -0.0
 12  7       0.5      -0.1       -0.0       -0.0
 12  8      -0.1       0.8        0.0        0.0
 12  9      -0.4       0.1        0.0       -0.0
 12 10      -0.2      -1.0       -0.1       -0.0
 12 11      -1.3       0.1       -0.0        0.0
 12 12      -0.7       0.2       -0.1       -0.1`;

const N = 12;
/** g[n][m], h[n][m] and their secular variation, nT and nT/year. */
const G: number[][] = [],
  H: number[][] = [],
  GD: number[][] = [],
  HD: number[][] = [];
for (let n = 0; n <= N; n++) {
  G.push(new Array(N + 1).fill(0));
  H.push(new Array(N + 1).fill(0));
  GD.push(new Array(N + 1).fill(0));
  HD.push(new Array(N + 1).fill(0));
}
for (const line of COF.trim().split('\n')) {
  const [n, m, g, h, gd, hd] = line.trim().split(/\s+/).map(Number);
  G[n][m] = g;
  H[n][m] = h;
  GD[n][m] = gd;
  HD[n][m] = hd;
}

/** Schmidt semi-normalisation factors S[n][m] (Gauss-normalised P -> Schmidt P). */
const S: number[][] = [];
for (let n = 0; n <= N; n++) {
  S.push(new Array(N + 1).fill(0));
  S[n][0] = n === 0 ? 1 : (S[n - 1][0] * (2 * n - 1)) / n;
  for (let m = 1; m <= n; m++) S[n][m] = S[n][m - 1] * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
}

// WGS 84 and the geomagnetic reference radius, km.
const WGS84_A = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const RE = 6371.2;

export interface MagneticField {
  /** North, east, down components, nT. */
  x: number;
  y: number;
  z: number;
  /** Horizontal intensity, total intensity, nT. */
  h: number;
  f: number;
  /** Declination (E positive) and inclination (down positive), degrees. */
  decl: number;
  incl: number;
}

/**
 * Main field of WMM2025 at a geodetic position.
 * @param lat geodetic latitude, degrees
 * @param lon longitude, degrees east
 * @param heightKm height above the WGS 84 ellipsoid, km
 * @param year decimal year (e.g. 2026.5)
 */
export function wmmField(lat: number, lon: number, heightKm: number, year: number): MagneticField {
  const dt = year - WMM_EPOCH;
  const phi = (lat * Math.PI) / 180,
    lam = (lon * Math.PI) / 180;
  // geodetic -> geocentric spherical
  const sinPhi = Math.sin(phi),
    cosPhi = Math.cos(phi);
  const rc = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinPhi * sinPhi);
  const p = (rc + heightKm) * cosPhi;
  const zc = (rc * (1 - WGS84_E2) + heightKm) * sinPhi;
  const r = Math.hypot(p, zc);
  const phiC = Math.asin(zc / r);
  // Legendre functions of cos(theta) = sin(phiC), theta = geocentric colatitude; derivatives d/dtheta.
  const ct = Math.sin(phiC),
    st = Math.cos(phiC);
  const P: number[][] = [],
    dP: number[][] = [];
  for (let n = 0; n <= N; n++) {
    P.push(new Array(N + 1).fill(0));
    dP.push(new Array(N + 1).fill(0));
  }
  P[0][0] = 1;
  for (let n = 1; n <= N; n++) {
    for (let m = 0; m <= n; m++) {
      if (n === m) {
        P[n][m] = st * P[n - 1][m - 1];
        dP[n][m] = st * dP[n - 1][m - 1] + ct * P[n - 1][m - 1];
      } else {
        const k = n > 1 ? ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3)) : 0;
        P[n][m] = ct * P[n - 1][m] - (n > 1 ? k * P[n - 2][m] : 0);
        dP[n][m] = ct * dP[n - 1][m] - st * P[n - 1][m] - (n > 1 ? k * dP[n - 2][m] : 0);
      }
    }
  }
  let bx = 0,
    by = 0,
    bz = 0; // geocentric north, east, down
  const ar = RE / r;
  let arn = ar * ar; // (a/r)^(n+2) starts at n = 0
  for (let n = 1; n <= N; n++) {
    arn *= ar;
    for (let m = 0; m <= n; m++) {
      const g = G[n][m] + dt * GD[n][m],
        h = H[n][m] + dt * HD[n][m];
      const cm = Math.cos(m * lam),
        sm = Math.sin(m * lam);
      const pnm = S[n][m] * P[n][m],
        dpnm = S[n][m] * dP[n][m];
      const gh = g * cm + h * sm;
      bx += arn * gh * dpnm;
      by += st > 1e-12 ? (arn * m * (g * sm - h * cm) * pnm) / st : 0;
      bz -= (n + 1) * arn * gh * pnm;
    }
  }
  // rotate to the geodetic frame
  const psi = phiC - phi;
  const x = bx * Math.cos(psi) - bz * Math.sin(psi);
  const z = bx * Math.sin(psi) + bz * Math.cos(psi);
  const y = by;
  const h = Math.hypot(x, y);
  return {
    x,
    y,
    z,
    h,
    f: Math.hypot(h, z),
    decl: (Math.atan2(y, x) * 180) / Math.PI,
    incl: (Math.atan2(z, h) * 180) / Math.PI,
  };
}

/**
 * Magnetic declination (variation) in degrees, EAST POSITIVE, at a position, altitude and date.
 * magnetic = true - variation (e.g. TC 090, 5E -> MC 085).
 * Dates outside 2025.0-2030.0 are extrapolated with the secular variation (less accurate).
 *
 * @param lat  geodetic latitude, degrees
 * @param lon  longitude, degrees (east positive)
 * @param date flight date 'YYYY-MM-DD' (decimal year computed from it) or a Date
 * @param altFt altitude above MSL, ft (default 0; taken as height above the ellipsoid)
 */
export function magneticVariation(lat: number, lon: number, date: IsoDate | Date, altFt = 0): number {
  const y = decimalYear(date);
  return wmmField(lat, lon, ((isFinite(altFt) ? altFt : 0) * 0.3048) / 1000, isFinite(y) ? y : WMM_EPOCH).decl;
}

/** True if the date lies inside the model's validity (2025.0-2030.0). */
export function wmmValid(date: IsoDate | Date): boolean {
  const y = decimalYear(date);
  return y >= WMM_EPOCH && y < WMM_VALID_UNTIL;
}

/** Decimal year of a date, e.g. '2026-07-02' -> 2026.5. */
export function decimalYear(date: IsoDate | Date): number {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00Z') : date;
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1),
    end = Date.UTC(y + 1, 0, 1);
  return y + (d.getTime() - start) / (end - start);
}

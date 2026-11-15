// Weather proxy (data agent): GET /weather/metar?ids=LGAV,LGTT → MetarTafResponse from
// aviationweather.gov. STUB until the data agent implements it.
import type { Route } from '../http.js';
import { HttpError } from '../http.js';

export const routes: Route[] = [
  {
    method: 'GET', path: '/weather/metar',
    async handler() {
      throw new HttpError(501, 'not implemented');
    },
  },
];

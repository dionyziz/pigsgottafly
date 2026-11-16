import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/api/**/*.test.ts', 'src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
    // no test reaches Open-Meteo, aviationweather.gov or autorouter (tests/setup/noExternalApis.ts)
    setupFiles: ['tests/setup/noExternalApis.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/api/**/*.test.ts', 'src/**/__tests__/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

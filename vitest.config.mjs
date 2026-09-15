import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `tests/` holds the GeoPackage generation suites. The metric engine keeps
    // its tests colocated with the module under test, as it did before the
    // move — see src/metric/README.md.
    include: ['tests/**/*.test.mjs', 'src/metric/**/*.test.mjs']
  }
})

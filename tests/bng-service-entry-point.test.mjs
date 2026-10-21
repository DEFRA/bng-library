// Guards the 'bng-library/bng-service' package contract, as
// src/metric/entry-point.test.mjs does for 'bng-library/metric': these tests go
// in through the package specifier, so a mistake in the "exports" map of
// package.json fails here rather than in bng-metric-backend.

import { readFileSync } from 'node:fs'
import { dirname, relative as relativePath, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

import * as root from '../index.mjs'
import * as relative from '../src/bng-service/index.mjs'

const subpath = await import('bng-library/bng-service')

const ENTRY_POINT = fileURLToPath(
  new URL('../src/bng-service/index.mjs', import.meta.url)
)
const PACKAGE_ROOT = resolve(dirname(ENTRY_POINT), '..', '..')

/**
 * The complete public surface. Spelled out rather than derived from the module
 * so that adding or removing an export has to be a deliberate edit here too.
 */
const PUBLIC_EXPORTS = [
  'BASELINE',
  'CURRENT_TEMPLATE_VERSION',
  'FEATURE_UUID',
  'FORMAT_BNG_SERVICE',
  'FORMAT_LEGACY',
  'GEOMETRY_COLUMN',
  'HABITAT_REF',
  'LAYERS',
  'PARENT_GEOM',
  'PARENT_REF',
  'PARENT_UUID',
  'POST_INTERVENTION',
  'RED_LINE_BOUNDARY',
  'STAGE_BASELINE',
  'STAGE_POST_INTERVENTION',
  'TEMPLATE_DROP_DOWNS',
  'TEMPLATE_SCHEMA',
  'TEMPLATE_SOURCE',
  'UNREADABLE_GEOMETRY',
  'VALID_FORMATS',
  'VALID_STAGES',
  'checkLineage',
  'checkTemplateValues',
  'readVersionRecords',
  'tableName',
  'templateTable',
  'versionRecordText'
]

/** The root entry point's name for an export, where it differs. */
const ROOT_NAMES = { LAYERS: 'BNG_SERVICE_LAYERS' }

// Static and dynamic imports, re-exports and require() calls.
const MODULE_SPECIFIER =
  /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g

/**
 * Every module file reachable from `entry` by relative import, and every bare
 * specifier (package or Node built-in) any of them loads.
 */
function importGraph(entry) {
  const files = new Set()
  const packages = new Set()
  const pending = [entry]
  while (pending.length > 0) {
    const file = pending.pop()
    if (files.has(file)) {
      continue
    }
    files.add(file)
    for (const match of readFileSync(file, 'utf8').matchAll(MODULE_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3]
      if (specifier.startsWith('.')) {
        pending.push(resolve(dirname(file), specifier))
      } else {
        packages.add(specifier)
      }
    }
  }
  return {
    files: [...files].map((file) => relativePath(PACKAGE_ROOT, file)),
    packages: [...packages]
  }
}

describe("the 'bng-library/bng-service' subpath export", () => {
  it('resolves through the package exports map', () => {
    expect(subpath.readVersionRecords).toBeTypeOf('function')
  })

  it('exposes exactly the documented public surface', () => {
    expect(Object.keys(subpath).sort()).toEqual(PUBLIC_EXPORTS)
  })

  it('is the same module the relative import gives, not a second copy', () => {
    for (const name of PUBLIC_EXPORTS) {
      expect(subpath[name]).toBe(relative[name])
    }
  })

  it('agrees with the root entry point on everything both export', () => {
    for (const name of PUBLIC_EXPORTS) {
      const rootName = ROOT_NAMES[name] ?? name
      if (rootName in root) {
        expect(subpath[name]).toBe(root[rootName])
      }
    }
  })

  it('loads neither xlsx nor the workbook code', () => {
    // The service does not install xlsx, so one import that reaches it would
    // make the whole subpath unloadable there.
    const { files, packages } = importGraph(ENTRY_POINT)
    expect(packages).not.toContain('xlsx')
    expect(
      files.filter((file) => /^src\/workbook(-writer)?\//.test(file))
    ).toEqual([])
  })

  it('reads the version record a consumer will look for', () => {
    const db = new Database(':memory:')
    try {
      db.exec(
        'CREATE TABLE gpkg_metadata (id INTEGER PRIMARY KEY, md_standard_uri TEXT, metadata TEXT)'
      )
      db.prepare(
        'INSERT INTO gpkg_metadata (md_standard_uri, metadata) VALUES (?, ?)'
      ).run(subpath.TEMPLATE_SOURCE.metadataUri, subpath.versionRecordText())
      expect(subpath.readVersionRecords(db)).toEqual([
        {
          format: subpath.FORMAT_BNG_SERVICE,
          version: subpath.CURRENT_TEMPLATE_VERSION
        }
      ])
    } finally {
      db.close()
    }
  })

  it('names the template tables a reader opens', () => {
    expect(
      subpath
        .templateTable(subpath.tableName('habitats', subpath.POST_INTERVENTION))
        .columns.map((column) => column.name)
    ).toEqual(
      expect.arrayContaining([
        subpath.HABITAT_REF,
        subpath.PARENT_REF,
        subpath.PARENT_UUID,
        subpath.PARENT_GEOM
      ])
    )
    expect(
      subpath
        .templateTable(subpath.tableName('habitats', subpath.BASELINE))
        .columns.map((column) => column.name)
    ).toContain(subpath.FEATURE_UUID)
  })
})

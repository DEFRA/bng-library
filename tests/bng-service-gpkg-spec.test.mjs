/**
 * The template's GeoPackage specification, as the sync script copies it, and
 * what the library reads from it: the schema, the drop-downs and the version.
 * The specification and the CSV reference lists are copied from one template
 * commit, so a list a drop-down reads that the copy does not hold, or a key
 * column the list no longer has, fails here.
 */
import { describe, expect, it } from 'vitest'

import {
  GPKG_SPEC,
  TEMPLATE_DROP_DOWNS,
  TEMPLATE_SCHEMA,
  TEMPLATE_SOURCE,
  referenceList,
  templateDropDowns
} from '../src/bng-service/reference.mjs'

const FID = 'fid'

const referenceDropDowns = Object.entries(TEMPLATE_DROP_DOWNS).flatMap(
  ([table, columns]) =>
    Object.entries(columns)
      .filter(([, dropDown]) => dropDown.kind === 'reference')
      .map(([column, dropDown]) => [`${table} / ${column}`, dropDown])
)

describe('the GeoPackage specification', () => {
  it('records the format and version its version record names', () => {
    expect(TEMPLATE_SOURCE.format).toBe(GPKG_SPEC.format)
    expect(TEMPLATE_SOURCE.version).toBe(GPKG_SPEC.templateVersion)
  })

  it('gives the schema every table, with its columns besides fid and the geometry', () => {
    expect(TEMPLATE_SCHEMA.tables).toHaveLength(GPKG_SPEC.tables.length)
    for (const [i, table] of TEMPLATE_SCHEMA.tables.entries()) {
      const names = GPKG_SPEC.tables[i].columns.map(({ name }) => name)
      expect(names.slice(0, 2)).toEqual([FID, table.geometryColumn])
      expect(names.slice(2)).toEqual(table.columns.map(({ name }) => name))
    }
  })

  it('finds the reference drop-downs', () => {
    expect(referenceDropDowns.length).toBeGreaterThan(0)
  })

  it.each(referenceDropDowns)(
    '%s reads a copied list that has its key column',
    (_, { list, key }) => {
      const rows = referenceList(list)
      expect(rows.length).toBeGreaterThan(0)
      expect(Object.keys(rows[0])).toContain(key)
    }
  )
})

describe('reading a specification’s drop-downs', () => {
  const specWith = (dropDown) => ({
    tables: [
      { name: 'Hedgerows Baseline', columns: [{ name: 'Type', dropDown }] }
    ]
  })

  it('reads them as TEMPLATE_DROP_DOWNS holds them', () => {
    expect(templateDropDowns(GPKG_SPEC)).toEqual(TEMPLATE_DROP_DOWNS)
  })

  it('refuses a kind it does not know, naming the column', () => {
    expect(() => templateDropDowns(specWith({ kind: 'range' }))).toThrow(
      '"Hedgerows Baseline"."Type" has a drop-down of unknown kind "range"'
    )
  })

  it('refuses a list outside the CSV References, naming the column', () => {
    expect(() =>
      templateDropDowns(
        specWith({
          kind: 'list',
          list: 'Other/Types.csv',
          storedColumn: 'Type'
        })
      )
    ).toThrow(
      '"Hedgerows Baseline"."Type" reads a list outside CSV References/: Other/Types.csv'
    )
  })
})

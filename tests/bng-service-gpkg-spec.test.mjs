/**
 * The template's GeoPackage specification, as the sync script copies it,
 * against the schema it reads from the template's own GeoPackage. Both come
 * from one template commit, so a sync that updated one and not the other, or
 * a specification that no longer describes the template, fails here.
 */
import { describe, expect, it } from 'vitest'

import {
  GPKG_SPEC,
  TEMPLATE_SCHEMA,
  TEMPLATE_SOURCE
} from '../src/bng-service/reference.mjs'

const FID = 'fid'

/** A spec table's columns as the schema lists them: no fid, no geometry. */
const attributeColumns = (table) =>
  table.columns
    .filter(({ name }) => name !== FID && name !== table.geometryColumn)
    .map(({ name, type }) => ({ name, type }))

describe('the GeoPackage specification', () => {
  it('describes the template format and version the schema came from', () => {
    expect(GPKG_SPEC.format).toBe(TEMPLATE_SOURCE.format)
    expect(GPKG_SPEC.templateVersion).toBe(TEMPLATE_SOURCE.version)
  })

  it('lists the same tables as the schema, in the same order', () => {
    expect(GPKG_SPEC.tables.map(({ name }) => name)).toEqual(
      TEMPLATE_SCHEMA.tables.map(({ name }) => name)
    )
  })

  describe.each(TEMPLATE_SCHEMA.tables.map((table) => [table.name, table]))(
    '%s',
    (name, schemaTable) => {
      const specTable = GPKG_SPEC.tables.find((table) => table.name === name)

      it('has the same geometry column, type and coordinate system', () => {
        expect(specTable).toMatchObject({
          geometryColumn: schemaTable.geometryColumn,
          geometryType: schemaTable.geometryType,
          srsId: schemaTable.srsId
        })
      })

      it('has the schema columns, in order, besides fid and the geometry', () => {
        expect(attributeColumns(specTable)).toEqual(schemaTable.columns)
      })

      it('lists fid and the geometry column, which the schema leaves out', () => {
        const names = specTable.columns.map((column) => column.name)
        expect(names).toContain(FID)
        expect(names).toContain(schemaTable.geometryColumn)
      })

      it('names the stage the table is read at', () => {
        expect(specTable.stage).toEqual(expect.any(String))
      })
    }
  )
})

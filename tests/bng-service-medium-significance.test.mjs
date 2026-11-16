/**
 * The Metric's middle strategic significance, "Location ecologically
 * desirable but not in local strategy" (Medium), has no place in the BNG
 * Service template. A source that holds it, such as a Metric workbook filled
 * in before a Local Nature Recovery Strategy was published, is written as
 * Low with a warning: left blank, the service would price it at zero.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  generateBngServiceFromWorkbook,
  generateBngServiceSynthetic
} from '../index.mjs'
import { captureMessages } from '../src/log.mjs'
import { HABITAT_REF } from '../src/bng-service/schema.mjs'
import { layerFromSources } from '../src/bng-service/site-features.mjs'
import {
  MEDIUM_SIGNIFICANCE,
  proposedSignificanceOf
} from '../src/bng-service/vocabulary.mjs'

const SQUARE = {
  type: 'Polygon',
  coordinates: [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
      [0, 0]
    ]
  ]
}

function parcel(index, significance) {
  return {
    index,
    geometry: SQUARE,
    ref: `P${index}`,
    retention: 'Enhanced',
    comment: null,
    baseline: {
      broad: 'Grassland',
      type: 'Modified grassland',
      condition: 'Poor'
    },
    proposed: {
      broad: 'Grassland',
      type: 'Modified grassland',
      condition: 'Moderate',
      significance,
      advance: '0',
      delay: '0'
    }
  }
}

function proposedSignificances(sources) {
  const { result, messages } = captureMessages(() =>
    layerFromSources('habitats', sources, {
      uuidFor: (layerKey, index) => `${layerKey}-${index}`,
      choose: () => 0
    })
  )
  const byRef = {}
  for (const { values } of result.postIntervention) {
    byRef[values[HABITAT_REF]] = values['Proposed Strategic Significance']
  }
  return { byRef, messages }
}

describe('a proposed Medium strategic significance', () => {
  it('is written as Low, and the other wordings keep their own value', () => {
    const { byRef } = proposedSignificances([
      parcel(0, MEDIUM_SIGNIFICANCE),
      parcel(1, `2. ${MEDIUM_SIGNIFICANCE}`),
      parcel(2, 'Formally identified in local strategy'),
      parcel(3, 'Area/compensation not in local strategy/ no local strategy')
    ])
    expect(byRef).toEqual({ P0: 'Low', P1: 'Low', P2: 'High', P3: 'Low' })
  })

  it('warns once for each row it changes, naming the layer and the row', () => {
    const { messages } = proposedSignificances([
      parcel(0, MEDIUM_SIGNIFICANCE),
      parcel(1, 'Formally identified in local strategy')
    ])
    const warnings = messages.filter(
      (m) => m.level === 'warn' && m.message.includes(MEDIUM_SIGNIFICANCE)
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0].message).toMatch(/^\s*habitats P0: .*written as Low/)
  })
})

describe('a proposed Medium strategic significance in a generated file', () => {
  const CENTRE = [530000, 180000]
  let dir
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'bng-medium-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // The file's Area Habitats Post-Intervention rows, and the Medium warnings.
  function generated(name, generate) {
    const file = path.join(dir, name)
    const { messages } = captureMessages(() => generate(file))
    const db = new Database(file, { readonly: true })
    try {
      const rows = db
        .prepare(
          `SELECT "Habitat Ref" AS ref, "Retention Category" AS retention,
            "Proposed Strategic Significance" AS significance
          FROM "Area Habitats Post-Intervention" ORDER BY "Habitat Ref"`
        )
        .all()
      const warnings = messages
        .filter(
          (m) => m.level === 'warn' && m.message.includes(MEDIUM_SIGNIFICANCE)
        )
        .map((m) => m.message.trim())
      return { rows, warnings }
    } finally {
      db.close()
    }
  }

  it('is written as Low from a native override', () => {
    const { rows, warnings } = generated('native.gpkg', (file) =>
      generateBngServiceSynthetic(
        file,
        CENTRE,
        {
          numParcels: 2,
          seed: 1,
          attributeOverrides: {
            habitats: [
              {
                retention: 'Enhanced',
                proposedStrategicSignificance: MEDIUM_SIGNIFICANCE
              },
              { retention: 'Created', proposedStrategicSignificance: 'High' }
            ]
          }
        },
        { templateFeatures: false }
      )
    )
    expect(rows).toEqual([
      { ref: 'H001', retention: 'Enhanced', significance: 'Low' },
      { ref: 'H002', retention: 'Created', significance: 'High' }
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/^habitats H001: .*written as Low/)
  })

  it('is written as Low from Created and Enhanced workbook rows', () => {
    const workbook = structuredClone(
      JSON.parse(
        readFileSync(
          new URL('./fixtures/scenario-workbooks.json', import.meta.url),
          'utf8'
        )
      )['strategic-significance/spread']
    )
    workbook.habitats.created[0].strategicSignificance = MEDIUM_SIGNIFICANCE
    workbook.habitats.enhancements[0].proposedStrategicSignificance = `2. ${MEDIUM_SIGNIFICANCE}`
    const { rows, warnings } = generated('workbook.gpkg', (file) =>
      generateBngServiceFromWorkbook(file, workbook, 'medium.xlsx', {
        centre: CENTRE,
        seed: 2
      })
    )
    expect(rows).toEqual([
      { ref: 'H001', retention: 'Created', significance: 'Low' },
      { ref: 'H002', retention: 'Created', significance: 'High' },
      { ref: 'H003', retention: 'Enhanced', significance: 'Low' }
    ])
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toMatch(/^habitats H001: .*written as Low/)
    expect(warnings[1]).toMatch(/^habitats H003: .*written as Low/)
  })
})

describe('proposedSignificanceOf', () => {
  it('substitutes Low for Medium, and keeps the other wordings', () => {
    expect(proposedSignificanceOf(`2. ${MEDIUM_SIGNIFICANCE}`)).toEqual({
      value: 'Low',
      substituted: true
    })
    expect(
      proposedSignificanceOf('Formally identified in local strategy')
    ).toEqual({ value: 'High', substituted: false })
    expect(proposedSignificanceOf(null)).toEqual({
      value: null,
      substituted: false
    })
  })
})

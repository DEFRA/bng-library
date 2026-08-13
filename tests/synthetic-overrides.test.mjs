import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { openGeoPackageReadonly } from '../src/gpkg-io/index.mjs'
import {
  CULVERT_ENCROACHMENT,
  CULVERT_TYPE
} from '../src/synthetic/synthetic-constants.mjs'
import {
  ALL_HABITATS,
  HEDGE_CONDITIONS,
  IN_SCOPE_HEDGE_TYPES,
  STRATEGIC_SIGNIFICANCE,
  generateOne,
  setMode
} from '../index.mjs'

// A generous parcel count so the derived hedgerow and river layers both carry
// at least two rows (row 0 pinned, row 1 exercises `incomplete`).
const NUM_PARCELS = 12
const CENTRE = [530000, 180000]

// Pick a Low- and a Medium-distinctiveness habitat from the real vocabulary so
// the assertions never hard-code a habitat name that might be re-banded.
const LOW_HABITAT = ALL_HABITATS.find((h) => h.distinctiveness === 'Low')
const MEDIUM_HABITAT = ALL_HABITATS.find((h) => h.distinctiveness === 'Medium')

const SS_LOCAL = STRATEGIC_SIGNIFICANCE[0]
const SS_OTHER = STRATEGIC_SIGNIFICANCE[2]
const HEDGE_TYPE = IN_SCOPE_HEDGE_TYPES[0]
const RIVER_TYPE = 'Canals'

describe('attributeOverrides — per-layer pinning', () => {
  let outDir
  let gpkgPath

  beforeAll(() => {
    setMode('silent')
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-overrides-'))
    gpkgPath = path.join(outDir, 'overrides.gpkg')
    generateOne(gpkgPath, CENTRE, {
      numParcels: NUM_PARCELS,
      attributeOverrides: {
        habitats: [
          {
            habitatFullName: LOW_HABITAT.fullName,
            proposedHabitatFullName: MEDIUM_HABITAT.fullName,
            retention: 'Enhanced',
            baselineCondition: LOW_HABITAT.validConditions[0],
            proposedCondition: MEDIUM_HABITAT.validConditions[0],
            baselineStrategicSignificance: SS_LOCAL,
            proposedStrategicSignificance: SS_OTHER
          },
          { retention: 'Created', advanceYears: '4', delayYears: '0' },
          { retention: 'Enhanced', incomplete: true },
          { retention: 'Created', delayYears: '2' },
          { retention: 'Created', advanceYears: '3' },
          {
            retention: 'Enhanced',
            incomplete: true,
            proposedCondition: MEDIUM_HABITAT.validConditions[0]
          }
        ],
        hedgerows: [
          {
            hedgeType: HEDGE_TYPE,
            retention: 'Retained',
            baselineCondition: HEDGE_CONDITIONS[0],
            proposedCondition: HEDGE_CONDITIONS[1],
            baselineStrategicSignificance: SS_LOCAL,
            proposedStrategicSignificance: SS_LOCAL
          },
          { retention: 'Enhanced', incomplete: true }
        ],
        rivers: [
          {
            riverType: RIVER_TYPE,
            retention: 'Retained',
            baselineCondition: 'Fairly Good',
            proposedCondition: 'Fairly Good',
            baselineStrategicSignificance: SS_OTHER,
            proposedStrategicSignificance: SS_OTHER,
            baselineWaterEncroachment: 'No Encroachment',
            proposedWaterEncroachment: 'No Encroachment',
            baselineRiparianEncroachment: 'No Encroachment/No Encroachment',
            proposedRiparianEncroachment: 'No Encroachment/No Encroachment'
          },
          { retention: 'Enhanced', incomplete: true }
        ]
      }
    })
  })

  afterAll(() => {
    setMode('cli')
    rmSync(outDir, { recursive: true, force: true })
  })

  const readRow = (table, ref) => {
    const db = openGeoPackageReadonly(gpkgPath)
    try {
      return db
        .prepare(`SELECT * FROM "${table}" WHERE "Parcel Ref" = ?`)
        .get(ref)
    } finally {
      db.close()
    }
  }

  it('pins a habitat row incl. a Low→Medium distinctiveness uplift', () => {
    const row = readRow('Habitats', 'H001')
    expect(row['Retention Category']).toBe('Enhanced')
    expect(row['Baseline Habitat Type']).toBe(LOW_HABITAT.type)
    expect(row['Proposed Habitat Type']).toBe(MEDIUM_HABITAT.type)
    expect(row['Baseline Distinctiveness']).toBe('Low')
    expect(row['Proposed Distinctiveness']).toBe('Medium')
    expect(row['Baseline Condition']).toBe(LOW_HABITAT.validConditions[0])
    expect(row['Proposed Condition']).toBe(MEDIUM_HABITAT.validConditions[0])
    expect(row['Baseline Strategic Significance']).toBe(SS_LOCAL)
    expect(row['Proposed Strategic Significance']).toBe(SS_OTHER)
  })

  it('pins habitat advance years on a created row', () => {
    const row = readRow('Habitats', 'H002')
    // A created area habitat is persisted with retention "Lost".
    expect(row['Retention Category']).toBe('Lost')
    expect(row['Habitat created in advance/years']).toBe('4')
    expect(row['Delay in starting habitat creation/years']).toBe('0')
  })

  it('zeroes advance when an override names only delay on a created row', () => {
    const row = readRow('Habitats', 'H004')
    expect(row['Delay in starting habitat creation/years']).toBe('2')
    expect(row['Habitat created in advance/years']).toBe('0')
  })

  it('zeroes delay when an override names only advance on a created row', () => {
    const row = readRow('Habitats', 'H005')
    expect(row['Habitat created in advance/years']).toBe('3')
    expect(row['Delay in starting habitat creation/years']).toBe('0')
  })

  it('blanks proposed cells on an incomplete habitat row', () => {
    const row = readRow('Habitats', 'H003')
    expect(row['Proposed Condition']).toBeNull()
    expect(row['Proposed Strategic Significance']).toBeNull()
  })

  it('keeps an explicitly pinned proposed cell on an incomplete row', () => {
    const row = readRow('Habitats', 'H006')
    expect(row['Proposed Condition']).toBe(MEDIUM_HABITAT.validConditions[0])
    expect(row['Proposed Strategic Significance']).toBeNull()
  })

  it('pins a hedgerow row', () => {
    const row = readRow('Hedgerows', 'HG001')
    expect(row['Retention Category']).toBe('Retained')
    expect(row['Baseline Hedge Type']).toBe(HEDGE_TYPE)
    expect(row['Proposed Hedge Type']).toBe(HEDGE_TYPE)
    expect(row['Baseline Condition']).toBe(HEDGE_CONDITIONS[0])
    expect(row['Proposed Condition']).toBe(HEDGE_CONDITIONS[1])
    expect(row['Baseline Strategic Significance']).toBe(SS_LOCAL)
  })

  it('blanks proposed cells on an incomplete hedgerow row', () => {
    const row = readRow('Hedgerows', 'HG002')
    expect(row['Proposed Condition']).toBeNull()
    expect(row['Proposed Strategic Significance']).toBeNull()
  })

  it('pins a watercourse row incl. encroachment', () => {
    const row = readRow('Rivers', 'R001')
    expect(row['Retention Category']).toBe('Retained')
    expect(row['Baseline River Type']).toBe(RIVER_TYPE)
    expect(row['Proposed River Type']).toBe(RIVER_TYPE)
    expect(row['Baseline Condition']).toBe('Fairly Good')
    expect(row['Proposed Condition']).toBe('Fairly Good')
    expect(row['Baseline Encroachment into Watercourse']).toBe(
      'No Encroachment'
    )
    expect(row['Proposed Encroachment into Watercourse']).toBe(
      'No Encroachment'
    )
    expect(row['Baseline Encroachment into riparian zone']).toBe(
      'No Encroachment/No Encroachment'
    )
  })

  it('blanks proposed cells on an incomplete watercourse row', () => {
    const row = readRow('Rivers', 'R002')
    expect(row['Proposed Condition']).toBeNull()
    expect(row['Proposed Strategic Significance']).toBeNull()
    expect(row['Proposed Encroachment into Watercourse']).toBeNull()
  })

  it('leaves unpinned rows fully populated', () => {
    const db = openGeoPackageReadonly(gpkgPath)
    try {
      const nulls = db
        .prepare(
          `SELECT count(*) AS n FROM "Habitats"
             WHERE "Parcel Ref" NOT IN ('H003')
               AND ("Proposed Condition" IS NULL
                 OR "Baseline Condition" IS NULL)`
        )
        .get()
      expect(nulls.n).toBe(0)
    } finally {
      db.close()
    }
  })
})

// A partial override must never break a cross-field invariant the random draw
// maintains: retention vs a differing proposed type, and the culvert
// encroachment sentinel. (The advance/delay pair is covered above.)
describe('attributeOverrides — coupled-field resolution', () => {
  let outDir
  let gpkgPath

  beforeAll(() => {
    setMode('silent')
    outDir = mkdtempSync(path.join(tmpdir(), 'bng-coupled-'))
    gpkgPath = path.join(outDir, 'coupled.gpkg')
    generateOne(gpkgPath, CENTRE, {
      numParcels: NUM_PARCELS,
      attributeOverrides: {
        // Every parcel pins a proposed habitat that differs from the baseline
        // but leaves retention to the random draw.
        habitats: Array.from({ length: NUM_PARCELS }, () => ({
          habitatFullName: LOW_HABITAT.fullName,
          proposedHabitatFullName: MEDIUM_HABITAT.fullName
        })),
        hedgerows: Array.from({ length: 4 }, () => ({
          hedgeType: IN_SCOPE_HEDGE_TYPES[0],
          proposedHedgeType: IN_SCOPE_HEDGE_TYPES[1]
        })),
        rivers: [
          // Row 0 is normally the seeded culvert; pinning an encroachment
          // degree without a type must steer the draw away from it.
          { baselineWaterEncroachment: 'Minor' },
          { riverType: 'Canals', proposedRiverType: 'Ditches' }
        ]
      }
    })
  })

  afterAll(() => {
    setMode('cli')
    rmSync(outDir, { recursive: true, force: true })
  })

  const allRows = (table) => {
    const db = openGeoPackageReadonly(gpkgPath)
    try {
      return db.prepare(`SELECT * FROM "${table}"`).all()
    } finally {
      db.close()
    }
  }

  it('never draws Retained for a habitat pinned to a differing proposed type', () => {
    const rows = allRows('Habitats')
    expect(rows.length).toBe(NUM_PARCELS)
    for (const row of rows) {
      expect(row['Proposed Habitat Type']).toBe(MEDIUM_HABITAT.type)
      expect(row['Retention Category']).not.toBe('Retained')
    }
  })

  it('never draws Retained for a hedgerow pinned to a differing proposed type', () => {
    const rows = allRows('Hedgerows')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row['Proposed Hedge Type']).toBe(IN_SCOPE_HEDGE_TYPES[1])
      expect(row['Retention Category']).not.toBe('Retained')
    }
  })

  it('never draws Retained for a watercourse pinned to a differing proposed type', () => {
    const row = allRows('Rivers').find((r) => r['Parcel Ref'] === 'R002')
    expect(row['Baseline River Type']).toBe('Canals')
    expect(row['Proposed River Type']).toBe('Ditches')
    expect(row['Retention Category']).not.toBe('Retained')
  })

  it('steers an encroachment-pinned row away from the seeded culvert', () => {
    const row = allRows('Rivers').find((r) => r['Parcel Ref'] === 'R001')
    expect(row['Baseline River Type']).not.toBe(CULVERT_TYPE)
    expect(row['Baseline Encroachment into Watercourse']).toBe('Minor')
  })

  it('rejects a culvert pinned with a non-sentinel encroachment', () => {
    expect(() =>
      generateOne(path.join(outDir, 'culvert-conflict.gpkg'), CENTRE, {
        numParcels: 4,
        attributeOverrides: {
          rivers: [
            { riverType: CULVERT_TYPE, baselineWaterEncroachment: 'Minor' }
          ]
        }
      })
    ).toThrow(/culvert/i)
  })

  it('accepts a culvert pinned with the sentinel encroachment', () => {
    const okPath = path.join(outDir, 'culvert-ok.gpkg')
    generateOne(okPath, CENTRE, {
      numParcels: 4,
      attributeOverrides: {
        rivers: [
          {
            riverType: CULVERT_TYPE,
            baselineWaterEncroachment: CULVERT_ENCROACHMENT
          }
        ]
      }
    })
    const db = openGeoPackageReadonly(okPath)
    try {
      const row = db
        .prepare(`SELECT * FROM "Rivers" WHERE "Parcel Ref" = 'R001'`)
        .get()
      expect(row['Baseline River Type']).toBe(CULVERT_TYPE)
      expect(row['Baseline Encroachment into Watercourse']).toBe(
        CULVERT_ENCROACHMENT
      )
    } finally {
      db.close()
    }
  })
})

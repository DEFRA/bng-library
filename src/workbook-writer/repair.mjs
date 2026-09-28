/**
 * Repair and normalise what LibreOffice leaves behind when it saves an .xlsx.
 *
 * Saving the Defra metric drops its customXml parts (document properties
 * SharePoint attached) but keeps the package relationships that point at
 * them. Excel treats a relationship to a missing part as damage and offers to
 * repair the file on opening. Removing those relationships is all the repair
 * needs: nothing refers to the parts themselves.
 */

import { resolveTarget } from './lint.mjs'
import { readZip, writeZip } from './xlsx-zip.mjs'

const RELATIONSHIP = /<Relationship\b[^>]*>/g
const ATTRIBUTE = (tag, name) =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null

function isDangling(zip, relsName, tag) {
  const target = ATTRIBUTE(tag, 'Target')
  if (ATTRIBUTE(tag, 'TargetMode') === 'External' || !target) {
    return false
  }
  return !zip.has(resolveTarget(relsName, decodeURI(target)))
}

function repairRelationships(zip, replacements) {
  for (const name of zip.names.filter((n) => n.endsWith('.rels'))) {
    const xml = zip.read(name).toString('utf8')
    const repaired = xml.replaceAll(RELATIONSHIP, (tag) =>
      isDangling(zip, name, tag) ? '' : tag
    )
    if (repaired !== xml) {
      replacements.set(name, repaired)
    }
  }
}

/**
 * @param {Buffer} buffer an .xlsx
 * @returns {Buffer} the same workbook without relationships to missing parts;
 *   the input itself when it has none
 */
export function removeDanglingRelationships(buffer) {
  const zip = readZip(buffer)
  const replacements = new Map()
  repairRelationships(zip, replacements)
  return replacements.size === 0 ? buffer : writeZip(zip, replacements)
}

const GUID =
  /\{[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}/gi
const AXIS_ID = /(<c:(?:axId|crossAx) val=")(\d+)(")/g
const GUID_TAIL_DIGITS = 12
const FIRST_AXIS_ID = 100_000
// The zip epoch, 1980-01-01 00:00, for every entry.
const DOS_EPOCH_DATE = (1 << 5) | 1
const DOS_EPOCH_TIME = 0

/**
 * Renumber identifiers LibreOffice makes up afresh on every save: the GUIDs
 * pairing each worksheet's conditional formats with their Excel 2010
 * extensions, and each chart's axis ids. Each is replaced consistently within
 * its part, in order of first appearance, so what refers to what is kept.
 */
function renumberIds(name, xml, partNumber) {
  const guids = new Map()
  const withGuids = xml.replaceAll(GUID, (guid) => {
    const key = guid.toUpperCase()
    if (!guids.has(key)) {
      const n =
        `${partNumber}`.padStart(4, '0') +
        `${guids.size + 1}`.padStart(GUID_TAIL_DIGITS - 4, '0')
      guids.set(key, `{00000000-0000-4000-8000-${n}}`)
    }
    return guids.get(key)
  })
  if (!name.startsWith('xl/charts/')) {
    return withGuids
  }
  const axes = new Map()
  return withGuids.replaceAll(AXIS_ID, (_, open, id, close) => {
    if (!axes.has(id)) {
      axes.set(id, FIRST_AXIS_ID + axes.size)
    }
    return `${open}${axes.get(id)}${close}`
  })
}

/**
 * Make a workbook LibreOffice saved reproducible and clean: relationships to
 * missing parts removed (see above), made-up identifiers renumbered, and every
 * zip entry dated the zip epoch. The same workbook recalculated twice then
 * gives the same bytes, so regenerating a committed corpus changes only the
 * workbooks whose content changed.
 *
 * @param {Buffer} buffer an .xlsx LibreOffice saved
 * @returns {Buffer}
 */
export function normaliseSavedWorkbook(buffer) {
  const zip = readZip(buffer)
  const replacements = new Map()
  repairRelationships(zip, replacements)
  zip.names
    .filter((n) => n.endsWith('.xml') && !n.endsWith('.rels'))
    .forEach((name, i) => {
      const xml = replacements.get(name) ?? zip.read(name).toString('utf8')
      const renumbered = renumberIds(name, xml, i + 1)
      if (renumbered !== xml) {
        replacements.set(name, renumbered)
      }
    })
  for (const entry of zip.entries) {
    entry.date = DOS_EPOCH_DATE
    entry.time = DOS_EPOCH_TIME
  }
  return writeZip(zip, replacements)
}

/**
 * bng-library/measure — the size of a BNG feature: the one definition of it.
 *
 * A feature's units are its size times its multipliers, so the size is part
 * of the metric's arithmetic and belongs beside it. The service prices each
 * area habitat on its area and each hedgerow and watercourse on its length,
 * measured from the geometry and left unrounded, as the metric prices "the
 * true value entered in each row" (User Guide, July 2025, Appendix Table F;
 * BMD-1042). The backend measures every feature it prices with these
 * functions, the red line boundary too, and the workbook writer measures the
 * metric's rows with them, so the two sides of the metric comparison carry the
 * same size by construction, to the last digit.
 *
 * Planar, over GeoJSON in British National Grid (EPSG:27700), so areas are in
 * square metres and lengths in metres. A caller holding another projection
 * reprojects first. The geometry is measured as given: the backend refuses a
 * GeoPackage with an invalid area parcel, so everything it prices is valid.
 *
 * Pure arithmetic with no dependencies, so the backend's validation worker
 * threads can load it without the GeoPackage or workbook machinery.
 *
 * The arithmetic is GEOS's (`GEOSArea` / `GEOSLength`), which measured sizes
 * before this module did. It is the textbook shoelace, but summed relative to
 * each ring's first vertex: on grid coordinates the plain form multiplies
 * numbers near 10⁵ into products near 10¹¹, and the cancellation between them
 * loses about five significant figures. Keeping GEOS's order of operations
 * means the sizes did not move when the backend switched to this module.
 */

// A closed ring needs at least three distinct points plus the closing one.
const MIN_RING_POINTS = 4

/**
 * Area of a GeoJSON Polygon or MultiPolygon: each polygon's exterior ring less
 * its holes. Anything else measures 0.
 *
 * @param {object | null | undefined} geometry GeoJSON geometry, EPSG:27700
 * @returns {number} square metres
 */
export function areaSquareMetres(geometry) {
  if (geometry?.type === 'Polygon') {
    return polygonArea(geometry.coordinates)
  }
  if (geometry?.type === 'MultiPolygon') {
    let total = 0
    for (const polygon of geometry.coordinates) {
      total += polygonArea(polygon)
    }
    return total
  }
  return 0
}

/**
 * Length of a GeoJSON LineString or MultiLineString: each segment as
 * `√(dx² + dy²)` (not `Math.hypot`, whose extra care over range can differ in
 * the last bit), each line summed before the lines are added. Anything else
 * measures 0.
 *
 * @param {object | null | undefined} geometry GeoJSON geometry, EPSG:27700
 * @returns {number} metres
 */
export function lengthMetres(geometry) {
  if (geometry?.type === 'LineString') {
    return lineLength(geometry.coordinates)
  }
  if (geometry?.type === 'MultiLineString') {
    let total = 0
    for (const line of geometry.coordinates) {
      total += lineLength(line)
    }
    return total
  }
  return 0
}

function polygonArea(rings) {
  const [shell, ...holes] = rings ?? []
  let area = ringArea(shell)
  for (const hole of holes) {
    area -= ringArea(hole)
  }
  return area
}

// The shoelace in its "x times the change in y" form, with x taken relative to
// the first vertex.
function ringArea(ring) {
  if (!ring || ring.length < MIN_RING_POINTS) {
    return 0
  }
  const x0 = ring[0][0]
  let sum = 0
  for (let i = 1; i < ring.length - 1; i++) {
    const x = ring[i][0] - x0
    sum += x * (ring[i - 1][1] - ring[i + 1][1])
  }
  return Math.abs(sum / 2)
}

function lineLength(coords) {
  let length = 0
  for (let i = 1; i < (coords?.length ?? 0); i++) {
    const dx = coords[i][0] - coords[i - 1][0]
    const dy = coords[i][1] - coords[i - 1][1]
    length += Math.sqrt(dx * dx + dy * dy)
  }
  return length
}

/**
 * Draw a synthetic site straight into the BNG Service site model. The site is
 * drawn by the same drawing step as the legacy format, from the same seed,
 * and built with the template's rules; no legacy file is written.
 */

import { clearSeed, setSeed } from '../../geometry.mjs'
import { drawSite } from '../../synthetic/draw/site.mjs'
import { moveVerticalHabitats } from '../vertical-from-area.mjs'
import { areaLayerOffers } from '../vocabulary.mjs'
import { badSite } from './bad-site.mjs'
import { siteFromDraw } from './site-from-draw.mjs'

/** Draw with the geometry module's random source seeded, if `seed` is. */
function withSeed(seed, fn) {
  const seeded = Number.isInteger(seed)
  if (seeded) {
    setSeed(seed)
  }
  try {
    return fn()
  } finally {
    if (seeded) {
      clearSeed()
    }
  }
}

/**
 * @param {[number, number]} centre
 * @param {object} plan  as for `generateOne`: numParcels, numTrees, seed,
 *   emptyLayers, attributeOverrides, geometricFlawNames
 * @param {ReturnType<import('../random.mjs').createChooser>} chooser  the
 *   source of feature identities and the values a drawn site does not hold,
 *   such as a tree's native or non-native type
 */
export function drawSyntheticSite(centre, plan, chooser) {
  const options = {
    uuidFor: (layerKey, index) => chooser.uuid(`${layerKey}/${index}`),
    choose: chooser.next
  }
  const geometricFlawNames = plan.geometricFlawNames ?? []
  const site =
    geometricFlawNames.length > 0
      ? badSite(centre, geometricFlawNames, options)
      : siteFromDraw(
          withSeed(plan.seed, () =>
            drawSite(centre, { ...plan, habitatFilter: areaLayerOffers })
          ),
          options
        )
  moveVerticalHabitats(site, (i) =>
    options.uuidFor('verticalHabitats/moved', i)
  )
  return site
}

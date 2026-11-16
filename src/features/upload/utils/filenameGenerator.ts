/**
 * Generate dataset filename from metadata + hash.
 * Format: {hash6}_{organism}_{organismPart}_{ionSource}_{pixelSizeX}_{polarity}
 * Example: 0e75ee_Human_Brain_MALDI_20_positive
 *
 * Organism is abbreviated from the config value format "CommonName (ScientificName)",
 * taking only the common name part and removing spaces/punctuation.
 */

function abbreviateOrganism(name: string): string {
  if (!name) return 'Unknown'
  // Extract common name: "Mouse (Mus musculus)" → "Mouse"
  // "E. coli (Escherichia coli)" → "Ecoli"
  const common = name.split('(')[0]!.trim()
  // Remove spaces and dots for clean filename token
  return common.replace(/[.\s]+/g, '')
}

export function generateDatasetFilename(metadata: Record<string, any>, fileHash: string): string {
  const organism = abbreviateOrganism(metadata.organism || 'Unknown')
  const part = (metadata.organism_part || 'Unknown').replace(/\s+/g, '_')
  const source = (metadata.ionisation_source || 'Unknown').replace(/[-\s]+/g, '_').toUpperCase()
  const pixelX = metadata.pixel_size_horizontal ?? metadata.pixel_size_vertical ?? '0'
  const polarity = (metadata.polarity || 'Unknown').replace(/[-\s]+/g, '_')
  const hash6 = fileHash.slice(0, 6)
  return `${hash6}_${organism}_${part}_${source}_${pixelX}_${polarity}`
}

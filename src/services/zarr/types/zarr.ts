/**
 * Domain types of the MassFlow MSI Zarr v1.1 store (see zarrStore.ts).
 */

export type DataMode = 'continuous' | 'processed'

/** Root attributes from /.zattrs */
export interface RootAttrs {
  format: string
  format_version: string
  write_state: string
  coordinate_order: string[]
  coordinate_base: number
  spatial_shape: [number, number]
}

/** Data group attributes from /data/.zattrs */
export interface DataAttrs {
  row_axis: 'pixel' | 'ion'
  encoding: 'continuous' | 'processed'
}

/** Metadata attributes from /metadata/.zattrs */
export interface MetadataAttrs {
  name?: string
  version?: number
  spectrum_count_num?: number
  max_count_of_pixels_x?: number
  max_count_of_pixels_y?: number
  pixel_size_horizontal?: number
  pixel_size_vertical?: number
  analyzer?: string
  ionisation_source?: string
  polarity?: string
  centroid_spectrum?: boolean
  profile_spectrum?: boolean
  continuous?: boolean
  processed?: boolean
  ms1_spectrum?: boolean
  msn_spectrum?: boolean
  filename?: string
  [key: string]: unknown
}

export interface PixelSpectrum {
  pixelIndex: number
  /** 1-based coordinate from axes/coordinates */
  x: number
  y: number
  mz: Float64Array
  intensity: Float32Array
}

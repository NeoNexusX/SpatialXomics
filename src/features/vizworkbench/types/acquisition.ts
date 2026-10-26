/**
 * 结果页的采集元数据：useResultMeta 从 zarr attrs、源文件记录、处理方法三个来源推导。
 *
 *  - 仪器（极性、离子源、分析器）：zarr 优先，源文件记录补空；分辨率只在源文件记录里有
 *  - 样本制备（基质、涂布方式、溶剂）：只来自源文件记录（上传后可编辑，zarr 里没有）
 *  - 数据形态（谱图模式、存储模式）：以处理后的结果为准（峰提取 → centroid，峰对齐 → continuous）
 *
 * 缺失的字段为空串。
 */
export interface Acquisition {
  polarity: string
  ionSource: string
  analyzer: string
  resolvingPower: string
  /** 分辨率的标定 m/z */
  resolvingPowerMz: string
  maldiMatrix: string
  maldiMatrixApplication: string
  solvent: string
  spectrumMode: string
  storageMode: string
}

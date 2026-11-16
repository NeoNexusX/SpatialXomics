/** Lightweight bridge. Importing it never loads the agent runtime or SDK. */
export interface DatasetBinding {
  id: string
  generation: number
  ready: boolean
}

let current: DatasetBinding = { id: '', generation: 0, ready: true }
const listeners = new Set<(binding: DatasetBinding) => void>()

export function datasetBinding(): DatasetBinding {
  return { ...current }
}

export function setAgentDataset(id: string, ready = false): number {
  current = { id, ready, generation: current.generation + 1 }
  for (const listener of listeners) listener(datasetBinding())
  return current.generation
}

export function markAgentDatasetReady(generation: number): void {
  if (generation !== current.generation) return
  current = { ...current, ready: true }
  for (const listener of listeners) listener(datasetBinding())
}

export function onAgentDatasetChange(listener: (binding: DatasetBinding) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

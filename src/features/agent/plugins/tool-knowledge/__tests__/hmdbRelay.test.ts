import { describe, expect, it } from 'vitest'
import { rewriteHmdbArchiveLocation, rewriteHmdbArchivePath } from '../hmdbRelay'

describe('HMDB local relay contract', () => {
  it('accepts only accession XML paths and optional 14-digit snapshots', () => {
    expect(rewriteHmdbArchivePath('/hmdb-archive/HMDB0003502.xml')).toBe(
      '/web/2id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    )
    expect(rewriteHmdbArchivePath('/hmdb-archive/HMDB0003502.xml?snapshot=20240722195439')).toBe(
      '/web/20240722195439id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    )
    expect(rewriteHmdbArchivePath('/hmdb-archive/anything.xml')).toBe('/__invalid_hmdb_archive_request__')
    expect(rewriteHmdbArchivePath('/hmdb-archive/HMDB0003502.xml?snapshot=bad')).toBe('/__invalid_hmdb_archive_request__')
  })

  it.each([
    'https://web.archive.org/web/20240722195439id_/https://hmdb.ca/metabolites/HMDB0003502.xml',
    'http://web.archive.org/web/20240722195439id_/http://www.hmdb.ca/metabolites/HMDB0003502.xml',
  ])('rewrites valid Wayback redirects back to same origin', (location) => {
    expect(rewriteHmdbArchiveLocation(location)).toBe(
      '/hmdb-archive/HMDB0003502.xml?snapshot=20240722195439',
    )
  })

  it('rejects unexpected redirect hosts and malformed snapshot URLs', () => {
    expect(
      rewriteHmdbArchiveLocation('https://evil.example/web/20240722195439id_/https://hmdb.ca/metabolites/HMDB0003502.xml'),
    ).toBeUndefined()
    expect(
      rewriteHmdbArchiveLocation('https://web.archive.org/web/2id_/https://hmdb.ca/metabolites/HMDB0003502.xml'),
    ).toBeUndefined()
  })
})

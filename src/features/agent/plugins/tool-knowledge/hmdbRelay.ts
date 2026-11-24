export function rewriteHmdbArchivePath(path: string): string {
  const request = new URL(path, 'http://localhost')
  const match = /^\/hmdb-archive\/(HMDB\d{5,})\.xml$/.exec(request.pathname)
  const snapshot = request.searchParams.get('snapshot')
  if (!match || (snapshot && !/^\d{14}$/.test(snapshot))) {
    return '/__invalid_hmdb_archive_request__'
  }
  return `/web/${snapshot ? `${snapshot}id_` : '2id_'}/https://hmdb.ca/metabolites/${match[1]}.xml`
}

/** Return a same-origin redirect only for supported Wayback → HMDB snapshot URLs. */
export function rewriteHmdbArchiveLocation(location: string | undefined): string | undefined {
  const match =
    typeof location === 'string' &&
    /^https?:\/\/web\.archive\.org\/web\/(\d{14})id_\/https?:\/\/(?:www\.)?hmdb\.ca\/metabolites\/(HMDB\d{5,})\.xml$/.exec(
      location,
    )
  return match ? `/hmdb-archive/${match[2]}.xml?snapshot=${match[1]}` : undefined
}

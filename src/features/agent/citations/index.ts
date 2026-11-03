/** Shared model-facing citation contract. Markdown links become Inline Citation cards. */
export const INLINE_CITATION_TOOL_HINT =
  ' Cite external evidence beside the supported claim as [source title](URL), optionally [source title](URL "short source excerpt"); the UI renders these links as Inline Citation cards. Use only retrieved source URLs or identifiers.'

export const INLINE_CITATION_INSTRUCTIONS = `## External citations
Cite literature, databases and other external evidence immediately after the supported claim using [source title](URL), optionally [source title](URL "short source excerpt"). The app renders HTTP(S) Markdown links as shadcn-vue Inline Citation source cards; do not output Vue components, custom HTML, bare URLs, numeric citation markers or Markdown footnotes.
Use the actual source title and URL returned by a tool. If a returned identifier is the only link available, use https://pubmed.ncbi.nlm.nih.gov/PMID/ for a PMID or https://doi.org/DOI for a DOI; replace the placeholder with the exact retrieved identifier. Never invent titles, identifiers, quotes or URLs. Keep an optional excerpt short, on one line, and escape double quotes; omit it when no supporting passage was retrieved. Put separate source links next to a claim when several sources support it. Missing or failed retrieval does not justify a fabricated citation.`

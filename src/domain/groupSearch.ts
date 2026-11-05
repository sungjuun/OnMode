export const GROUP_SEARCH_LIMIT = 120

export function normalizeGroupSearch(query: string) {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

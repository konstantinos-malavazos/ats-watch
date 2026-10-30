# workingnomads.json fixture note

REAL, trimmed, 2026-10-30. Cut from the live response saved that day
(GET https://www.workingnomads.com/api/exposed_jobs/, 38 postings): 4 postings
kept verbatim except descriptions cut to their first paragraph. Real test
data, not a synthetic shape.

The real payload is a bare JSON array, so this note lives in a sibling file
instead of a marker key inside `workingnomads.json` — adding a key there would
change the shape the adapter parses (same reason as `lever.README.md`).

# lever.json fixture note

SYNTHETIC - hand-built to the inferred response shape on 2026-08-23. NOT a
recorded live response; ATS egress was blocked in the authoring environment.
Re-record against the real endpoint before trusting field coverage.

The top-level shape of the real Lever postings endpoint is a bare JSON
array, so this note lives in a sibling file instead of a marker key inside
`lever.json` itself — adding a key there would corrupt the array shape the
adapter expects to parse.

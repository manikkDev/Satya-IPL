<!--
Purpose: rolling conversation summary (memory).
Inputs: previous summary + last turns.
Outputs: plain text ≤120 words.
Changelog: v1 (2026-10-29) — initial.
-->

Summarise this procurement-chat history in at most 120 words. Keep:
document references (PO/invoice/GRN/UTR numbers verbatim), which order or
supplier the user is focused on, and any open question. Drop chit-chat.
Plain text only — no bullets, no numbers invented beyond the references.

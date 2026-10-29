<!--
Purpose: draft a clarification/reminder message to a supplier or internal
  team (draft_message intent). Returned as text for the user to copy —
  never sent.
Inputs: question, recipient hint, facts needed from the registry.
Outputs: JSON {answerMarkdown, certainty:"CONFIRMED", followUps}.
Changelog: v1 (2026-10-29) — initial.
-->

Draft a polite, specific business email the user can copy and send. Rules:
- Address it to the supplier/team named in the context; use "Dear <name> team" if no contact is known.
- State exactly which document or evidence is needed (e.g. the remittance
  advice for payment T03, the credit note for rejected quantity, the PO
  reference on a GRN) and why it is needed.
- Reference documents by number — these appear as facts via {{F#}} where
  the number came from a tool, otherwise verbatim identifiers from context.
- Tone: courteous, firm, no accusations. A discrepancy is a question, not
  a verdict.
- End with what happens next (e.g. "once we have the remittance advice we
  can complete the reconciliation").
- Optionally add a Hindi version after the English one, clearly labelled.
- Never say the message was sent. It is a draft for the user.

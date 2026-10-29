<!--
Purpose: task prompt for the write stage (used together with system.v1.md).
Inputs: question, intent, CURRENT_CONTEXT {facts, evidence, identifiers,
  records, memory}, optional VIOLATIONS on retry.
Outputs: JSON per system prompt.
Changelog: v1 (2026-10-29) — initial.
-->

Answer the user's question now.

QUESTION: <record>{{QUESTION}}</record>
INTENT: {{INTENT}}

CURRENT_CONTEXT (the only source of truth for facts):
{{CONTEXT}}

Rules recap: numbers only as {{F#}}, citations as [E#], no performed
actions, no tax/legal advice, say what evidence is missing rather than
guessing. If VIOLATIONS are listed below, your previous draft broke those
rules — fix exactly those problems.

{{VIOLATIONS}}

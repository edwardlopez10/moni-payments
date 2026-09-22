---
resource:
  id: "RS-001"
  title: "Moniveo Spec Workflow (initialize-spec)"
  source: "prompts/initialize-spec.md"
  spec_slug: "moniveo-payments-service"
  created: "2026-09-18T22:45:00Z"
  updated: "2026-09-18T22:45:00Z"
---

# Moniveo Spec Workflow (initialize-spec)

## Source

`prompts/initialize-spec.md`, copied into this repository from
`/Users/edward/Documents/moni-resident/prompts/`. The five workflow files are byte-identical between
`moni-resident` and `moni-health`, so they represent a settled house convention rather than one
team's local preference.

## Summary

`initialize-spec` is step 1 of a five-step workflow: **initialize_spec → create_resource →
update_spec → create_tasks → execute_task**. It defines the `spec.md` skeleton — YAML frontmatter,
four anchored sections, and zero-padded sequential identifiers — that every subsequent step edits
mechanically. The anchors exist so later steps can rewrite one section without disturbing the
others.

## Key Insights

- **Frontmatter**: `title`, `slug`, `status`, `created`, `updated`, `version`. Status starts at
  `draft` and moves through `ready` to `done`. `version` increments as the spec evolves; the
  `admin-panel` spec in `moni-resident` reached version 8.
- **Anchors**: `<!-- @section:overview -->`, `requirements`, `resources`, `tasks`, each closed with
  `<!-- @end -->`. Mature specs add unanchored sections such as `## Architecture summary`,
  `## Decisions`, `## Out of Scope`, and `## Open questions`.
- **Identifiers**: `R-001`, `RS-001`, `T-001`, always three digits. Numbering never backfills; a
  merged requirement is retained as `(R-002) [merged into R-003]` so external references stay valid.
- **Timestamps**: UTC ISO 8601, `YYYY-MM-DDTHH:MM:SSZ`.
- **Requirement style at step 1**: observable outcomes only, no technology names. Technology enters
  at step 3 (`update_spec`), after resources have been analysed.
- **Task anatomy** (added at step 4): a `###` heading carrying `(T-0NN)` and a status tag, then
  `#### Overview`, `#### Acceptance Criteria`, `#### Implementation Details`. Status tags are
  `[pending]`, `[in-progress]`, `[done <UTC ISO>]`, `[blocked <reason>]`. Tasks are sized at one to
  three hours and separated by `---`.
- **Execution record**: `execute-task` appends an Execution Summary listing files changed, each
  acceptance criterion with PASS or FAIL, tests run, and notes.

## Spec Alignment

Governs the form of this entire specification rather than any single requirement:

- Every requirement `R-001` onward follows the outcome-oriented phrasing rule.
- The task list satisfies the one-to-three-hour sizing rule and the three-subsection anatomy, so
  `execute-task` can consume tasks without reinterpretation.
- All four anchored sections are present and in canonical order, keeping the document compatible
  with steps 2 through 5.

## Implementation Blueprint

Two deviations from the literal template, both deliberate:

**Design documents in `design/`.** The brief asked for six artifacts — repository structure, Prisma
model, provider interface, lifecycle diagram, API specification, testing strategy — before any
implementation. Inlining all six would push `spec.md` past 2,500 lines, roughly 1.5 times the
largest existing spec, and would bury the requirements and tasks that steps 3 through 5 operate on.
They are therefore `specs/moniveo-payments-service/design/0N-*.md`, summarised and linked from the
`## Architecture Summary` section. The anchored sections keep their canonical contents, so the
workflow tooling is unaffected.

**Mermaid diagrams.** Neither sibling repo uses Mermaid; `moni-health` uses ASCII box diagrams. The
brief explicitly requests Mermaid in `docs/architecture.md`, and a nine-state payment machine with
conditional refund edges is not legible as ASCII. Mermaid is used in the design documents and will
carry into `docs/`, establishing a new convention for this repository.

## Risks & Considerations

- Splitting the design detail out of `spec.md` means a reader who opens only `spec.md` sees
  summaries. Mitigated by linking every design document from the Architecture Summary and keeping
  each task's Implementation Details pointed at the relevant one.
- This is a greenfield repository, so `create-tasks` cannot follow its instruction to inspect an
  existing codebase for patterns. The conventions were instead drawn from `moni-resident` and
  `moni-health` and captured in RS-002 and RS-003.
- Requirement count (34) far exceeds the "2-5 typical" guidance in the prompt, which assumes a
  feature-sized change. A whole service warrants the larger set; grouping under `###` subheadings
  follows the precedent set by the `resident-app-ui-refresh` spec.

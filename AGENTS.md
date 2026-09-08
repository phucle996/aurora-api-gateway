# Aurora Agent Rules

@/home/phucle/.codex/RTK.md

## Workflow-first development

- Prioritize end-to-end workflows over files, packages, services, or abstractions.
- Before implementing, clearly determine the workflow owner, authority source, durable boundary, retry/settlement rule, failure mode, and security invariants.
- Each change should only impact the requested workflow. Never drag along cleanups or refactorings of other workflows.
- Prefer placing implementations inside the module/workflow owner to maintain strict dependency direction and minimize blast radius.
- Test against workflow behavior and boundaries: success, failure, retry/replay, stale events, authorization, and recovery when applicable.

## Workflow isolation over helpers

- Do not create helper functions by default.
- Keep logic at the workflow owner and call site when it makes ownership, state transitions, and failure paths clearer.
- Only introduce a helper when strictly required for correctness or security, or when an invariant cannot be maintained consistently across call sites without genuine operational risk.
- Helpers must have the narrowest possible scope: prioritize private functions within the same workflow/module, followed by package-local. Never move helpers into shared/global utilities without proven identical contracts across multiple workflows.
- Do not create generic abstractions, utility layers, or reusable helpers in anticipation of future needs.
- Do not refactor existing code into helpers solely due to syntactic similarity when semantics, authority, or failure behavior belong to different workflows.
- If adding a helper is unavoidable, the change description must explain why an inline/workflow-local implementation is insufficient and how the helper preserves workflow isolation.

## Flat workflow and flat entity

- Each workflow must have its own command, projection/result, service port, and repository port; do not reuse result entities of other workflows as inputs or authorities for the current workflow.
- API workflow entities must be flat projections specific to the workflow owner. Do not nest `Schedule -> Version -> Bracket`; do not embed or compose entities of other workflows to save on mapping effort.
- Repeated line/bracket records are only permitted as child types named after that specific workflow. Do not share a common input type across publish, detail, cache, estimate, or settlement workflows.
- Only kernel primitives may compose kernel value objects/snapshots when such composition is an intrinsic kernel invariant. API/module workflows cannot rely on this exception.
- Never invoke read/detail workflows from mutation/publish workflows. Mutations must read authority via their own dedicated projection/port.
- Prefer explicit mapping and minor duplication per workflow over abstractions or entity graphs that obscure ownership.

## CTE-first repository

- Repositories should prioritize Common Table Expressions (CTEs) to express target, authority, latest version, winner, count, and mutation projections within a single, traceable SQL query.
- Use multi-statement transactions when durable transitions involve genuine multiple mutation boundaries; do not split queries merely to reuse repository methods from other workflows.
- CTEs must not become shared abstractions. Each query remains bound to exactly one repository port/workflow and returns flat projections for that workflow.

## Workflow contexts, never God Contexts

- Do not use `#[allow(clippy::too_many_arguments)]` to unblock builds or mask design debt. Any exception requires explicit user approval before commit.
- When a workflow requires multiple capabilities, create a dedicated context within the owning module. The context must contain only capabilities genuinely utilized by that workflow.
- Business data, signed inputs, and transport inputs must flow through workflow-named command/request types; never mix them into capability contexts.
- `AppContext`, `ServiceContext`, dependency bags, or shared contexts spanning workflows without common authority/failure boundaries are strictly forbidden.
- Do not move dependencies into a context solely to reduce argument counts. Each field must reflect a concrete capability, input, or invariant of the workflow owner.

## Required working order

2. Trace the workflow end-to-end through existing code/config/contracts.
3. Lock in ownership, Source of Truth, invariants, and failure semantics.
4. Implement changes with the smallest workflow blast radius.
5. Verify against the correct boundary via behavioral tests and checks.

Deeper `AGENTS.md` files throughout the directory tree define subtree-specific rules and must be read prior to working in those subtrees.

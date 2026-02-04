# Documentation Index

This folder is intentionally detailed so another AI model or developer can continue work without relying on chat history.

## Files

- `docs/implementation-spec.md`  
  Source of truth for scope, contract boundaries, APIs, state machines, and failure handling.
- `docs/architecture.md`  
  Component and data flow architecture (including VRF flow and trust boundaries).
- `docs/decisions.md`  
  Confirmed decisions and runtime parameters (plus optional future tuning knobs).
- `docs/deployments.md`  
  Deployed contract addresses by network and post-deploy verification notes.
- `docs/handoff.md`  
  Current project status, immediate next tasks, and execution commands for quick continuation.
- `docs/security-analysis.md`  
  Security model and checklist template (to be filled with findings after implementation).
- `docs/gas-optimization.md`  
  Gas measurement and optimization log template (to be filled after implementation and profiling).

## Priority Rule

If any document conflicts:

1. `docs/implementation-spec.md`
2. `docs/decisions.md`
3. `docs/architecture.md`
4. Other files

# Agent rules for Codebase Explainer AI

## Project
Monorepo: shared/ (Zod types), backend/ (Express + TypeScript), frontend/ (React) and
frontend-vanilla/ (plain HTML/CSS/JS, if present). The active frontend is frontend-vanilla/ if it
exists and works, otherwise frontend/. Do not delete the other one.

## Always
- Integrate into the EXISTING app. No mocked data, no separate demo, no redesign, no breaking
  existing endpoint shapes. Existing tests must keep passing.
- Nothing fabricated: every file, function, line, edge and explanation comes from the analyzed
  repository. Unknown stays "unknown".
- Every relationship and description has confidence ("confirmed" | "inferred" | "unknown") and
  evidence {filePath, startLine, endLine, kind}. Only show line numbers that were really computed.
- Code shown to users is copied from stored repository files, never written by the AI.
- No native node-gyp modules that need a C++ toolchain (team uses Windows). Allowed: the
  "typescript" compiler API, web-tree-sitter (WASM), better-sqlite3 only if it installs cleanly
  with prebuilt binaries, otherwise node:sqlite. Put storage behind an interface.
- New file/path endpoints: reject path traversal, absolute paths and paths not in the repo.
  Validate params and bodies with Zod. Keep the existing rate limiter. Never expose keys.
- Never use innerHTML for repo text, file paths, code or LLM output (use textContent). Only
  exceptions: sanitized markdown and library-generated SVG.
- Respect GitHub rate limits, size limits, and Gemini free-tier limits. Call Gemini lazily, batched
  per file, cached; never send unrelated files.
- Tests (vitest) for everything added. Comments in simple English.

## Working method
1. Read the relevant code first. Print a short plan (files, endpoints, types, assumptions).
2. Implement only the current task.
3. Run `npm run typecheck` and `npm test`. Fix every failure before finishing.
4. Manually test as described in the task. Print a PASS/FAIL checklist with real evidence
   (command output, response bodies), not claims.
5. Print a 5-line summary: what changed, how to test, what is missing.

## Debug protocol (when anything fails)
1. Reproduce it and capture the exact error, command and input.
2. Find the ROOT CAUSE (read the code path, add temporary logging if needed). No guessing.
3. Fix the cause, not the symptom. Never delete, skip, or weaken a test to make it pass.
4. Add a regression test for the bug.
5. Re-run typecheck, the full test suite and the manual check. Remove temporary logging.
6. Report: symptom, root cause, fix, test added.

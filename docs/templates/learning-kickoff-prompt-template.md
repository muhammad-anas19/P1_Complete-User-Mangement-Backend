# Learning-Project Kickoff Prompt (Reusable Template)

> **What this is:** A generic, fill-in-the-blank prompt you can hand to an AI coding agent at the start of *any* future learning project — not specific to this dashboard or to NestJS. It's the distilled, reusable version of the prompt you gave at the start of this backend build, which produced [phase-0-auth-rbac-understanding-check.md](../qa/phase-0-auth-rbac-understanding-check.md).
>
> **Why it's worth reusing (not just "asking well" each time):** the value wasn't the specific questions asked about cookies/RBAC — it was the *shape* of the request: review existing context first, propose phases, gate each phase behind an understanding check *you* answer, get evaluated like a junior engineer would by a senior reviewer, and get a persistent doc out of it. That shape works for any topic (a message queue, a caching layer, a CI/CD pipeline, a new frontend state library) — only the subject matter changes.
>
> **Note on location:** this file lives under `backend/docs/` only because that's the scope you asked me to work in for this project. It's not backend-specific — copy it into wherever you keep personal notes/templates across projects (e.g., a `learning-templates/` folder outside any single project repo), since you'll want it before Project 2, 3, etc.

---

## The Template

Copy the block below, fill in the bracketed placeholders, and send it as your opening message for a new learning project.

```
I am building [PROJECT_NAME], a [ONE-LINE DESCRIPTION], as project #[N] in my
personal roadmap to go from [CURRENT LEVEL] to [TARGET LEVEL] engineer over
[TIMEFRAME].

Context:
- Related/existing code to review first: [PATH(S) — e.g. a sibling frontend
  folder, an existing repo, a design doc]
- Scope boundary: you may only create/modify files inside [FOLDER SCOPE].
  Do not touch [OUT-OF-SCOPE PATHS].
- Stack: [LANGUAGE / FRAMEWORK / DB / etc., or "you decide and justify the
  choice to me before proceeding"]

Before writing any code:
1. Review [existing folder/docs] to understand the real context and
   constraints this component must satisfy. Summarize what you find, and
   explicitly flag any contradictions or ambiguities you notice instead of
   silently resolving them.
2. Propose a phased build plan. Do not proceed past Phase 0 without my
   sign-off.
3. Before EACH phase, ask me conceptual + technical understanding-check
   questions about that phase's subject matter — not "which option do you
   prefer" implementation-preference questions, but understanding questions.
   Questions should probe:
   - WHY this technique/pattern exists — what problem it solves, what breaks
     without it.
   - The mechanics I should be able to explain out loud, not just recall a
     keyword for.
   - Common misconceptions, attack vectors, or failure modes relevant to the
     topic.
4. When I answer, evaluate rigorously, the way a senior engineer reviewing a
   junior's understanding would: mark each answer correct / partially
   correct / needs more depth, correct any misconception directly and
   explicitly, and expand with the detail I was missing. Do not just
   validate everything I say back to me.
5. After evaluating, tell me explicitly whether I'm ready to proceed to that
   phase, or whether I should study more first — and name the specific
   topics/keywords worth reading before continuing.
6. Only after my understanding for that phase is confirmed, implement it.

Documentation requirements:
- Write all Q&A plus your evaluation into a persistent doc I can review
  later (e.g. before interviews) — not just chat output that scrolls away.
- Maintain living docs for [architecture / design patterns / whatever fits
  this project], written so a future engineer (or future me, cold) could
  onboard from them alone.

Quality bar for this project:
- [e.g. production-grade folder structure, migrations not schema-sync,
  automated tests, API docs via Swagger/OpenAPI, a security review pass
  specific to this domain]

Do not:
- Skip ahead and implement before I've answered and been evaluated on the
  current phase's questions.
- Silently make architecture/design decisions that I should be forming my
  own opinion on — tell me the tradeoff and let me choose, or if you decide
  for me, say so explicitly and justify it rather than picking silently.
```

---

## Notes on Why Each Section Exists

(Read this once now; skip it on future reuses once it's internalized.)

- **"Review existing context first"** — without this, the agent designs in a vacuum and produces something technically fine but disconnected from the actual project it needs to plug into (e.g., an auth backend that doesn't match the frontend's actual token-storage assumptions).
- **"Propose phases, gate on sign-off"** — prevents the single biggest failure mode of AI-assisted learning: getting a fully-working feature dropped on you that you never had to reason about, so you can run it but can't explain it in an interview.
- **"Ask understanding questions, not preference questions"** — the difference matters. "Do you want TypeORM or Prisma?" tests nothing. "Why do migrations matter, and what breaks without them?" tests whether you actually understand the thing you're about to depend on.
- **"Evaluate rigorously, don't just validate"** — an agent that only ever says "great answer!" is worthless as a learning tool. You explicitly want correction, not encouragement, at this stage.
- **"Persistent doc, not just chat output"** — chat scrolls away and gets summarized/compacted over a long session; a doc survives, gets re-read before interviews, and can be diffed/updated as your understanding improves.
- **"Quality bar" section** — states the non-negotiables up front (tests, migrations, docs, API contracts) so the agent doesn't quietly skip them under the assumption that "it's just a learning project."
- **"Do not skip ahead / do not silently decide"** — the two most common ways an eager agent undermines the entire point of a learning project, stated as explicit guardrails rather than hoped-for behavior.

---

## Suggested Personal Ritual Per New Project

1. Fill in the template above.
2. After Phase 0 questions come back evaluated, actually go read the "Suggested Reading" list before answering the next phase's questions — don't just power through on gut instinct twice in a row.
3. Ask for the phase-N understanding-check doc to be appended to (or created alongside) the project's `docs/` folder, same pattern as this project.
4. At the end of the whole project, ask for one consolidated "if this were a system-design interview about what you just built, here's what you'd be asked" doc — a natural extension of the per-phase docs, useful as a single review artifact.

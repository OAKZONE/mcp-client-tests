# Contributing

Pull requests are welcome — especially ones that correct a vendor fact, add a client surface, or
report that the harness itself misled you.

## The one rule

**Assertions come from the specification, never from a server under test.**

A suite written to describe what some implementation currently does is green on every defect that
implementation has. The whole value of this package is detecting where an implementation and a
specification disagree, and it can only do that if the specification is the source. So:

- **Every expectation cites a clause** in `src/harness/specifications.ts`, and the citation travels
  into the failure message. A PR that adds an assertion without one will be asked for the source.
- **A vendor profile changes only when that vendor's documentation changes**, with `verifiedAgainst`
  updated in the same commit. Never to make a red test green.
- **Only vendor-established facts are asserted.** Where a vendor records a behaviour as unverified,
  pin the behaviour under test and name the uncertainty in the docstring — do not promote a guess
  into a requirement, because a suite that fails correct servers gets switched off.

If your server fails a test, read the citation first. If the clause says what the assertion says,
the finding is real. **We would much rather hear that than have the assertion softened.**

## Practicalities

```bash
npm install
npm run validate     # typecheck + lint + the package's own tests + build
```

`AGENTS.md` carries the layout, the import rules, the design rules (MCT01–MCT05), the QA matrix, and
the release process. `docs/extending.md` covers adding a client surface or a whole test family.

Before a release the suites are run against a real consuming server — the package's own tests cover
its pure units and cannot tell you a suite still passes against a live deployment.

## Licensing of contributions

This project is licensed under the [Apache License 2.0](LICENSE). Per section 5 of that licence, any
contribution you intentionally submit for inclusion is licensed under the same terms, with no
additional conditions — no separate CLA to sign. Copyright in your contribution remains yours.

## Reporting a harness bug

Two harness artefacts have previously looked exactly like server faults: a pooled keep-alive socket
producing a bare `400` with no body, and a shared cleanup marker deleting a sibling suite's signed-in
holder. If a failure is fast, empty, and untraceable in your own server log, it may be a third —
please open an issue rather than working around it.

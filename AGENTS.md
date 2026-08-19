# Project Development Rules

This project is an independent continuation of the last AGPL-licensed
NocoDB codebase.

## Licensing boundary

Never copy, port, translate, adapt, or reconstruct source code from
NocoDB versions released after the upstream license transition.

Do not bypass or modify NocoDB Enterprise licensing mechanisms.

Do not use proprietary NocoDB Enterprise source code as an implementation
reference.

## Allowed references

You may use:

- source code contained in this AGPL repository
- general software engineering knowledge
- public standards
- public API specifications
- publicly documented user-facing behavior
- independently licensed open-source libraries

## Feature implementation

Features similar to commercial NocoDB features must be implemented
independently.

Implement the capability, not the proprietary implementation.

For example:

Allowed:
"Implement a Gantt view for records containing start/end dates."

Not allowed:
"Find how current NocoDB Enterprise implements Gantt and port it."

## Architecture

Prefer extending existing abstractions instead of introducing
feature-specific hacks.

Every new major feature should include:

- backend implementation
- frontend implementation
- database migrations if required
- API definitions
- tests
- documentation

## Compatibility

Preserve compatibility with existing databases and APIs whenever
reasonable.

## Commits

Keep changes small and independently reviewable.
# Known Issues

## ESLint `no-undef` errors

Found by running `eslint .` (see `eslint.config.js`, gitignored, ESLint installed globally). These reference identifiers that aren't defined anywhere in scope — likely typos or leftovers from a rename.

- `classes/ECS/entity.js:89` — `nameExcludingSuffix` is not defined
- `classes/ECS/entity.js:125` — `rotationB` is not defined
- `classes/ECS/entity.js:130` — `rotationB` is not defined
- `classes/ECS/entity.js:210` — `paramComponentSuffix` is not defined
- `entity components/camera_controller_first_person.js:221` — `resultRotationCamera` is not defined

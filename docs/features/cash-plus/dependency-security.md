# Dependency security review

13 September 2026. This records the dependency remediation performed while preparing the complete Cash+ branch for review. No advisory was ignored, no security gate was weakened and no custom security fork was introduced.

## Result

| Audit severity | Before | After |
|---|---:|---:|
| Critical | 2 | 0 |
| High | 44 | 2 |
| Moderate | 51 | 3 |
| Low | 9 | 3 |
| Total | 106 | 8 |

The final lockfile still causes `pnpm audit --audit-level=high` to exit with code 1 because the two remaining high advisories have no published fixed release. This is an explicit delivery limitation; the CI audit remains enabled with its original threshold.

## Direct updates

| Package | Previous | Updated |
|---|---|---|
| `next` | 15.5.18 | 15.5.24 |
| `@next/third-parties` | 15.5.18 | 15.5.24 |
| `vitest` | 4.1.7 | 4.1.11 |
| `@vitest/coverage-v8` | 4.1.7 | 4.1.11 |

The Next patch resolves the reported critical issues and permits the patched sharp dependency. The test runner and coverage provider advance together within the same patch series. React, Privy, wagmi, the Aqua SDKs and the platform's major versions remain unchanged.

`pnpm-workspace.yaml` contains narrow overrides for vulnerable installed ranges of Axios, brace-expansion, browserslist, fast-uri, form-data, Hono, js-yaml, nanoid, PostCSS, socket.io-parser, Undici 7, Vite 8 and ws 8. These select published fixes within their existing major version. Overrides should be reviewed when the parent dependencies adopt the fixes themselves.

Four older helper dependencies arrive through the Uniswap SDK's published contract/tooling dependency tree. Their overrides are restricted to their existing callers:

| Existing caller | Patched helper | Compatibility boundary |
|---|---|---|
| Hardhat 2 | adm-zip 0.6.0 | CommonJS constructor, ZIP creation and `extractAllTo` |
| Hardhat 2 | Undici 6.28.0 | `Agent`, `ProxyAgent`, `Client`, `Pool`, `request` and response body APIs |
| Mocha 10 | serialize-javascript 7.0.5 | CommonJS serialization of regular expressions and dates; supports the repository's Node 22 |
| solc 0.8.26 | tmp 0.2.7 | `fileSync({ postfix })` and `removeCallback` |

These changes do not upgrade Hardhat or the Solidity compiler. Targeted compatibility smoke checks exercise the used ZIP, temporary-file, serialization and local HTTP request interfaces; they do not constitute an audit of those tools. The ordinary application, Aqua and Uniswap regression suites remain relevant after dependency updates.

The ZIP, serializer and Undici smoke checks passed on the versions above. The temporary-file smoke initially passed on tmp 0.2.6, then a separate advisory affecting that version required the final 0.2.7 patch. The final lockfile includes 0.2.7. Synchronizing the local installation and repeating that small temporary-file check is deferred until the concurrent full test/build runs finish; do not replace dependencies beneath an active verification process.

## Remaining high advisories: image-size

The dependency path is:

`@storybook/nextjs-vite` → `vite-plugin-storybook-nextjs` → `image-size@2.0.2`.

- [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr): ICNS parser denial of service through an infinite loop.
- [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq): JXL and HEIF parser denial of service through infinite loops.

Both advisories specify a patched range of `>=2.0.3`. At review time the npm registry's latest release is `2.0.2`, and `image-size@2.0.3` cannot be installed. Downgrading does not resolve the reported vulnerable range (`<=2.0.2`). The dependency is used by the Storybook/Vite Next image processing tooling, so untrusted image files supplied to that tooling remain relevant to these advisories.

The branch retains the package and reports the findings. It does not suppress them, re-label a vulnerable version, remove the CI audit or make an unreviewed major Storybook migration. Once a fixed release is published, update the dependency, regenerate the lockfile and rerun the audit and Storybook build.

## Reproduce

```bash
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm audit --json
```

Counts reflect the advisory database at review time and can change independently of source commits. The remaining moderate and low findings were left visible; this remediation focused on fixes for the blocking high/critical findings without unrelated platform migrations.

# Solana spoke production interface

Read-only upstream source: `smartcontract-v2` integration commit
`f40f0106ffd1cc0273c58cf99466efb889456f11` (PR #50).
Program: `7PptZ653uyn5eoAFKqs4DXR1ijxH6sf49f2YAGMLTfCx`.

`pp_spoke.json` copies `solana/target/idl/pp_spoke.json` from the final
production build. Its upstream SHA256 is
`305cc4d5d38667fe2c6353123b7fd0ae0df3f078d8c435dc168dc223143ec24b`.
The checked-in copy adds only a final newline; its SHA256 is
`e82538e0acd6e4da6cc744b4aaa059872c785fa05075a47c7e131ddedeed1d2e`.
`pp_spoke.ts` is the unmodified generated camelCase type helper; SHA256
`5c4e1869ebdc4c4742c7febf6da9a84712ccda5bd3d64de25a84d39cc4dc2923`.
Both files are excluded from Biome to preserve generated release content.

DEC-190/200: bootstrap program identity and instruction discriminators come
from this release. DEC-204: Scope remains disabled; stock references and LP
options remain unavailable even if backend metadata claims availability.
The program is not deployed by this copy operation. Existing backend wiring
and separately approved deployment remain prerequisites to live transactions.

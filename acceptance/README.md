# Minecraft Acceptance Bot

Deterministic Java 26.2 client harness in the authoritative `C:\MinecraftAI\mindcraft` repository. It is separate from Dingbat's AI planner and does not ask an LLM to judge results. The production route is `portal.hanksfirewood.com:25565` through the Oracle relay and Velocity. Direct Paper backend access is not a normal test path because Velocity requires online authentication and PROXY-v2 traffic from its relay.

## Current scope

Milestone 1 implements Microsoft-authenticated connect, player spawn, position, dimension, game mode, health, food, experience, full inventory snapshot, bounded movement, a conservative `/server` backend query, disconnect, JSON/Markdown reports, and deterministic unit tests. `/server` is recorded as unknown unless its response unambiguously names a backend. Login, movement, and backend identification are **not verified** until a dedicated licensed Java account signs in and a real run succeeds.

Milestones 2 and 3 (travel, inventory and Ender round trips, Creative isolation, GUI, treasure, machinery, and Manager correlation) require that first successful login. The harness creates no world fixtures in milestone 1. It does not have OP or RCON access.

## Pinned 26.2 stack

Install with `C:\Program Files\nodejs\npm.cmd ci --ignore-scripts --no-audit --no-fund` from this directory. Node 22 or newer is required. The committed lockfile pins transitive packages. The compatibility distribution is by Complexity-ML; it is not upstream PrismarineJS 26.2 support.

| Package | Version | Release asset SHA-256 |
|---|---|---|
| mineflayer | `4.37.1+complexity.26.2.3` | `8e692c7bac7cca3eb4f09ff91b021dbe620b6beff925836c36df6f4e6f3d212e` |
| minecraft-data | `3.111.0+complexity.26.2.5` | `be871aa93d91733a37b296b6fe3cca4ec5333707d3474eb868979a4b567b0196` |
| minecraft-protocol | `1.66.2+complexity.26.2.3` | `8b72d382e3cc06779b2b54fc3e402291f46df3bc28fcc2c189b1fc25b3895dab` |
| prismarine-chunk | `1.40.0+complexity.26.2.0` | `259cb8234f428349eeee947a0f12ecddbb98792b6f37f59af2426dd9fedaf7cc` |
| prismarine-physics | `1.11.0+complexity.26.2.0` | `ce40438bb01a071fdf52474976eacf9254858012e819aaf41654212e28ab1653` |

Exact release URLs are in `package.json` and `package-lock.json`. Downloaded asset digests were checked on 2026-10-06. Do not swap individual protocol/data/physics packages independently.

## Commands

From this directory use `C:\Program Files\nodejs\node.exe src\cli.js <command>`:

```text
status
connect
whereami
inventory
test smoke
report latest
cleanup <run-id>
test smoke --dry-run
```

The first real connection prints a Microsoft device sign-in URL and short code. Use a dedicated licensed Java account. The local authentication cache is in `C:\MinecraftAI\AcceptanceRuntime\auth`, outside Git; reports are in `C:\MinecraftAI\AcceptanceRuntime\reports`. Set `MC_ACCEPTANCE_AUTH_ALIAS` only to distinguish the account's local cache; the actual Minecraft name and UUID come from the authenticated profile. Never commit or paste the cache. Each live run has a timestamped ID and exits nonzero on test or cleanup failure.

Voice infrastructure is separately monitored. This protocol client is not a Simple Voice Chat Fabric client and cannot prove spoken audio.

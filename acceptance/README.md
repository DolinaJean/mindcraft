# Minecraft Acceptance Bot

Deterministic Java 26.2 client harness in the authoritative `C:\MinecraftAI\mindcraft` repository. It is separate from Dingbat's AI planner and does not ask an LLM to judge results. The production route is `portal.hanksfirewood.com:25565` through the Oracle relay and Velocity. Direct Paper backend access is not a normal test path because Velocity requires online authentication and PROXY-v2 traffic from its relay.

## Current scope

Milestone 1 implements connect, player spawn, position, dimension, game mode, health, food, experience, full inventory snapshot, bounded movement, a conservative `/server` backend query, disconnect, JSON/Markdown reports, and deterministic unit tests. `/server` is recorded as unknown unless its response unambiguously names a backend. The owner chose an **offline local identity**. The default target is now an isolated local Paper + Velocity lab; production remains authenticated and unchanged. Lab results prove only the local lab path, not public Velocity or production-world behavior.

The local lab first login passed on 2026-10-06: `CodexTestBot`, offline UUID `d50e61be-d450-3b74-91b1-918afb61309e`, Java 26.2, backend `lab`, inventory snapshot, bounded movement, disconnect, and lab shutdown. The latest client run was `2026-10-06T19-26-04-982Z-788501`; the wrapper run was `2026-10-06T19-25-56-425Z-ff6f26`. Reports are under `C:\MinecraftAI\AcceptanceRuntime\reports\local-lab` and are intentionally outside Git. Local reports are not production acceptance.

Milestones 2 and 3 for the **live Multiverse** (travel, inventory and Ender round trips, Creative isolation, GUI, treasure, machinery, and Manager correlation) remain pending. Production Paper has `proxies.velocity.online-mode: true`, matching authenticated production Velocity. PaperMC requires that setting to match the proxy. An offline proxy cannot be routed into those live backends without changing their authentication contract, so this harness does not do that. The local lab creates no production fixtures and gives the bot no OP or RCON access.

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
test local-smoke
report latest
cleanup <run-id>
test local-smoke --dry-run
```

`test local-smoke` prepares and starts a private Paper 26.2 + Velocity lab on `127.0.0.1:25591` and `127.0.0.1:25590`, runs the offline `CodexTestBot` smoke, and gracefully stops both processes. The lab has its own random forwarding secret, world, and reports under `C:\MinecraftAI\AcceptanceRuntime`; it does not use the production forwarding secret or touch production backends. Run `test local-smoke --dry-run` to preview. Other live commands connect to the local lab while it is running.

The optional `MC_ACCEPTANCE_TARGET=production` target keeps Microsoft device-code authentication through the public Velocity route. Its cache is in `C:\MinecraftAI\AcceptanceRuntime\auth`, outside Git. It requires a licensed Java account and is not part of the offline local account acceptance. Each live run has a timestamped ID and exits nonzero on test or cleanup failure.

Voice infrastructure is separately monitored. This protocol client is not a Simple Voice Chat Fabric client and cannot prove spoken audio.

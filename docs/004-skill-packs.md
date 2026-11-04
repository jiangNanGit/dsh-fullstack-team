# Skill packs — a role's dependencies

A role is the unit of capability. The skills it needs are **dependencies of the role**, not assets of the installation: hire the Flutter engineer, provision the Flutter pack; drop the role, drop the pack.

That is different from a project pool. The project pool (`<repo>/.agents/skills`) is scoped by working directory and always on for that repository — there is no way to say "only for this role". A pack is scoped by the preset that declares it, so the gating happens where the role is chosen.

## Declaring one

```yaml
- id: dsh-fullstack-team-flutter
  name: dsh-fullstack-team
  config:
    providerName: dsh-fullstack-team
    include:
      - dev-orchestrator
      - acceptance-guard
    packs:
      - name: flutter
        dir: ~/.dsh/skill-packs/flutter
```

`providerName` identifies the plugin, not the role: it stays `dsh-fullstack-team` in every preset (that is what `renderRoleEntry` writes). Isolation comes from the preset's own scope, not from a per-role provider name.

`dir` accepts an absolute path, a `~` path, or a path relative to the session cwd. `include` / `exclude` inside a pack apply to that pack only, so a pack can be trimmed per role without touching the bundle's own kit. The top-level `include` is literal (`*` is not a wildcard there); `*` means "the whole pack" only inside a pack's own `include:`.

Check a pack before mounting a role with `node scripts/roles.mjs` (from the package root; a source checkout needs `pnpm build` first) and audit its contents with `node scripts/skill-audit.mjs ~/.dsh/skill-packs/<name>`.

## What a missing pack does

The plugin refuses to start:

```
dsh-fullstack-team: skill pack "flutter" is not installed — expected a directory at
/Users/you/.dsh/skill-packs/flutter. Install the pack, or drop this role.
```

A role that silently runs without the capability it was hired for is worse than a role that will not start: the first produces confident wrong work, the second produces one line of text.

## What a collision does

Also a startup error. Two copies of one skill — the bundle's and the pack's — is exactly the ambiguity this flow exists to remove, so the plugin will not pick a winner for you.

## Provisioning a pack

Two shapes work today:

1. **A directory you fill.** Download or copy the pack to `~/.dsh/skill-packs/<name>/`; each subdirectory is one skill with a `SKILL.md`.
2. **A package that ships it.** If the pack is published on npm, install it into the profile and point `dir` at the `skills/` directory inside the installed package.

Nothing in the plugin knows what a Flutter is. It knows a role declared a dependency and that the dependency is present or absent.

## Why not just put the pack in the project?

Because a project pool cannot express "not this role". If the Flutter skills sit in the Flutter repository's `.agents/skills`, every session opened in that repository loads them — the backend session, the release session, the one answering a question about a log line. A pack is the same skills with a gate in front of them.

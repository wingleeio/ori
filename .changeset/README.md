# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

To record a change for the next release, run:

```bash
pnpm changeset
```

Pick the affected packages (`@wingleeio/ori-*`) and a bump type, and write a
short summary. Commit the generated markdown file alongside your change.

On merge to `main`, the **Release** workflow opens a "Version Packages" PR that
bumps versions and updates changelogs. Merging that PR publishes the packages to
npm. See [the docs](https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md)
for more.

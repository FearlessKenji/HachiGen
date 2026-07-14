HachiGen Patch Notes

These notes are written for people running the HachiGen desktop manager. For the full developer history, see [CHANGELOG.md](https://github.com/FearlessKenji/HachiGen/blob/main/CHANGELOG.md).

# Unreleased

## HachiGen

### Updates

- HachiGen now has its own repository, CI checks, smoke tests, and release workflow.

# v1.0.2 - 2026-07-14

## HachiGen

### Updates

- HachiGen now reports missing self-update release assets as unavailable instead of showing a manager error popup.
- HachiGen self-updates now use an in-app wizard with progress instead of opening a blank command window while waiting to replace and relaunch the app.
- HachiGen now uses `1.0.2` for its packaged app metadata.
- HachiGen now resolves approved system tools before launching them, reducing shell-command security warnings from GitHub CodeQL.

# Backups

A BrainCraft server backs up every board and wiki by itself. Nothing needs
turning on. This page covers what it keeps, how to put things back, and how to
keep a copy safe if the machine itself is lost.

## What the server keeps

- **Versions of every board and wiki.** A board that changed gets a saved
  version at most once an hour. One is also saved just before the board is
  deleted, and just before anyone puts it back to an earlier version. Anyone
  who can edit a board can also save a version with a name ("Before the
  reorg").
- **Older versions thin out:**
  - everything from the last two days;
  - then one a day for a month;
  - then one a week for six months;
  - then one a month for a year.

  Versions saved by hand, and the ones taken before a restore or a delete,
  stay for at least a month. The newest version of a board is always kept.
- **Files.** A board's files (PDFs, documents) are copied beside its versions,
  so putting a version back brings its files back too.
- **Deleted boards** stay for 90 days, with their owner, access list and
  files.
- **People, groups and settings** (with accounts) are copied once a day, and
  the last 30 days of copies are kept. This includes the sign-in sessions and
  API tokens, stored only as hashes, so people stay signed in after a restore.

The backups live in `backups/` inside the data folder, unless
`BRAINCRAFT_BACKUP_DIR` puts them elsewhere:

```
backups/
  boards/<board>/index.json          the board's versions, newest first
  boards/<board>/<version>.json.gz   one version (the board as stored)
  boards/<board>/deleted.json        present while a deleted board can be put back
  files/<board>/…                    copies of the board's files
  server/<day>.tar.gz                people, groups and settings, once a day
```

## Putting things back

- **One board or wiki:** open it, then **Version history** (board menu, or
  Ctrl+K "version") → **On the server**. Pick a version to preview it, then
  **Restore this version**.
  - It changes the board for everyone on it.
  - The board as it was just before is saved first, so you can restore that
    if you change your mind.
  - A wiki's page history and any time logged since stay as they are: they're
    a record of what happened. To take back just one wiki page, use that
    page's **Page history** instead.
- **A deleted board:** **Your boards → Recently deleted**, then **Put back**.
  Whoever managed the board can do this for 90 days, and admins can for any
  board.
- **The whole server**, on this machine or a new one:
  1. Get a full download (see below).
  2. Stop the server.
  3. Unpack the download into an empty data folder:

     ```sh
     tar -xzf braincraft-backup-2026-10-27.tar.gz -C braincraft-data
     ```

     `tar` comes with Windows 10 and 11, macOS and Linux.
  4. Start the server again.

The **Version history** tab **In this browser** is separate: those versions
are kept by the browser itself, for boards that aren't on a server.

## Keep a copy somewhere else

Backups in the same folder as the boards protect against mistakes, not
against losing the disk. Do at least one of these:

- **Point `BRAINCRAFT_BACKUP_DIR` at another disk** (or a synced folder such
  as OneDrive or Dropbox):

  ```sh
  BRAINCRAFT_BACKUP_DIR=D:\BrainCraft-backups
  ```

- **Download everything regularly.** Admins: **Admin… → Backups → Download
  everything**. It's one `.tar.gz` of the boards, their files, people, groups
  and settings. Scripts can fetch it with an admin's API token:

  ```sh
  curl -H "Authorization: Bearer bct_…" -o braincraft-backup.tar.gz https://your-server/api/admin/backup
  ```

- **Copy the data folder** with your usual backup tool. Copying it while the
  server runs is fine: boards and settings are written whole and then
  renamed, so a copy never catches one half-written.

**Admin… → Backups** shows where the backups are and how much space they use,
when they last ran, and any problem. It also has **Back up every board now**.

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRAINCRAFT_BACKUP_DIR` | `<data>/backups` | Where backups are kept. Better on another disk. |
| `BRAINCRAFT_BACKUP_EVERY` | `60` | Minutes between versions of a board that keeps changing (5 at least). |
| `BRAINCRAFT_BACKUPS` | on | `off` turns backups off. Deleted boards then can't be put back. |

## The API

| Route | Who | What |
| --- | --- | --- |
| `GET /api/boards/{id}/versions` | view | The board's versions, newest first. |
| `GET /api/boards/{id}/versions/{version}` | view | One version, with the board as it was. |
| `POST /api/boards/{id}/versions {note?}` | edit | Save a version now. |
| `POST /api/boards/{id}/versions/{version}/restore` | edit | Put the board back to it, for everyone (the board as it was is saved first). |
| `GET /api/backups/deleted` | signed in | Deleted boards you could put back. |
| `POST /api/backups/deleted/{id}/restore` | managed it, or admin | Put one back. |
| `GET /api/admin/backups`, `POST` | admin | How the backups stand, or a version of every board now. |
| `GET /api/admin/backup` | admin | Everything, as a `.tar.gz`. |

On a server without accounts, the version routes take the board's edit key or
view key, like the rest of the API. Deleting boards, and the admin routes,
need accounts.

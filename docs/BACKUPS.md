# Backups: what is kept, for how long, and the copy on GitHub

This page explains, in plain words, how the website keeps copies of every wedding. The code is in
`netlify/functions/_lib/_backup.ts` (making and keeping backups) and `netlify/functions/_lib/_github-backup.ts`
(the copy on GitHub). Putting a wedding back from a backup is done on the manager page (**Backups** → **Restore…**).

## What a backup is

A backup is one file with everything about the weddings at that moment: the families, their answers, what was sent
and opened, the messages, the invitation design (published and draft), the activity log and the helpers. It also holds
each wedding's password in a scrambled form (so logins work again after a restore), never the real password.
Uploaded pictures, music and videos are **not** inside backups: they are kept separately and are never deleted by a backup.

Backups are stored on Netlify (Netlify Blobs, store `backups`).

## When a backup is made

| When | File name | What is inside |
|---|---|---|
| Every night at 03:00 (UTC) | `<date>/all.json` | every wedding |
| When you tap **Make a backup now** on the manager page | `<date>/manual-<time>.json` | every wedding |
| Just before a restore replaces a wedding (the "safety copy") | `<date>/before-restore-<wedding>-<time>.json` | that wedding |
| When you archive a wedding | `<date>/archive-<wedding>-<time>.json` | that wedding |

## How long each one is kept

- **Nightly backups:** every one is kept for **90 days** (about three months).
  After 90 days, only the **first nightly backup of each calendar month** is kept, **for ever**. The others are deleted.
  So for an old month you still have one copy (from the start of that month), and for the last three months you have
  one copy for every night.
- **Backups you made by hand** (**Make a backup now**): kept **for ever**.
- **Safety copies made before a restore:** kept **for ever**.
- **Archive backups** (made when a wedding is archived): kept **for ever**. This is the wedding exactly as it was when
  it finished, so you can always look at or put back a wedding from a year ago.

Nothing else is ever deleted automatically. Weddings can be planned up to a year ahead, and every wedding that
finishes is archived, so the important copies are always there.

The **Backups** list on the manager page shows every backup that is still kept. Each backup is tiny (a few tens of
kilobytes per wedding), so keeping them costs almost nothing on Netlify.

For engineers: the list reply (`GET /api/manage/backups`) gives each row `kind` (`nightly`, `manual`, `before-restore`,
`archive`), `kept_forever` (true/false) and `kept_until` (the date a nightly backup will be deleted, or null).
The deleting is done by `prune()` after each nightly backup; it only ever deletes `<date>/all.json` files.

## A copy on GitHub

The backups above live on Netlify. If Netlify ever lost them, or the account were closed, they would be gone too.
So the website can also keep a copy of every wedding in **your own private GitHub repository** (a folder on GitHub).
This is switched on by two Netlify settings; the settings are in the table below.

| Setting on Netlify | What to put |
|---|---|
| `BACKUP_GITHUB_REPO` | your GitHub name and the repository name, for example `your-name/wedding-backups` |
| `BACKUP_GITHUB_TOKEN` | a GitHub "fine-grained personal access token" made for that one repository, with **Contents: Read and write** |

When both are set, after every nightly backup, every **Make a backup now** and every archive, the website writes:

- `weddings/<wedding>.json`: one file per wedding (families, answers, sends, opens, settings, the design, activity,
  helpers). **No passwords** of any kind. The file is laid out the same way every time, so GitHub's **History** shows
  exactly what changed between two days.
- `latest.json`: when the copy last changed, how many weddings and families there are, and the website address.
- `README.md`: a short note saying what this repository is (written once, only if it is missing).

A file is only written when it really changed, so a quiet night adds nothing. GitHub keeps every earlier version of each
file (open the file, then **History**). A wedding deleted on the website keeps its last file on GitHub; delete it there by
hand if the couple asks for their data to be removed.

The copy on GitHub is for **safe keeping and reading**. To put a wedding back, use the Netlify backups on the manager page.
An engineer can turn a GitHub file back into a working wedding if Netlify's copies were ever lost.

**If the copy fails, the backup itself still works.** The result is recorded with the backup, and the manager page's
health check (`GET /api/manage/health`, field `github_backup`) reports:

- `configured`: both settings are present.
- `last_ok_at`: when the copy last worked.
- `last_error`: what is wrong, in plain words, for example "GitHub token is missing, wrong or expired." (the token was
  typed wrong, or it ran out), "The GitHub repository … was not found" (the name is wrong, or the token was made for a
  different repository), or "GitHub is busy…" (GitHub had a problem; it is tried twice more, then again with the next backup).
  It also warns when the token stops working in less than 30 days.
- `token_expires_at`: the day the token stops working (GitHub tells us).

**The token runs out.** GitHub tokens last at most a year. Put a reminder in your calendar 11 months after you make it,
and make a new one.

**Privacy.** The GitHub repository holds guests' names and phone numbers. Keep it **private**. Never make it public,
never add anyone to it who should not see the guest lists, and do not use the token anywhere else.

## Older safety nets

- Netlify Database can also be wound back to an earlier moment (point-in-time restore, in Netlify). That replaces
  everything for every wedding, so it is for a disaster only, with an engineer.
- **Download a copy of everything** on a wedding (manager page) saves one wedding as a file you can keep on your computer.

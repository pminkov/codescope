<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-light.svg">
    <img src="docs/images/logo-dark.svg" alt="CodeScope" width="448" height="96">
  </picture>
</h1>

<p align="center"><strong>Understand your codebase.</strong></p>

<p align="center">
  Explore a codebase with directory explanations, architecture and sequence diagrams,
  code flows, REST endpoint inventories, and answers linked to source.
  Runs locally using the Codex CLI.
</p>

<p align="center">
  <a href="package.json">
    <img
      src="https://img.shields.io/badge/version-0.1.0-527a60?style=flat-square"
      alt="Version 0.1.0"
    >
  </a>
  <a href="#run">
    <img
      src="https://img.shields.io/badge/node-%E2%89%A522-527a60?style=flat-square"
      alt="Node.js 22 or newer"
    >
  </a>
  <a href="LICENSE">
    <img
      src="https://img.shields.io/badge/license-MIT-527a60?style=flat-square"
      alt="License: MIT"
    >
  </a>
</p>

## Run

Requires Node.js 22+ and the Codex CLI on your PATH.

```sh
git clone https://github.com/pminkov/codescope.git
cd codescope
# Install dependencies using the exact versions in package-lock.json.
npm ci
codex login
npm start
```

Open [127.0.0.1:4310](http://127.0.0.1:4310), choose **Add project**, and select
or paste a folder path.

Use **Areas** to partition an application into a small set of responsibility boxes,
including user-facing capabilities, backend services, and infrastructure. Choose
**New area map**, enter a scope or leave it blank for the whole project, then choose
**Map areas**. Open a box to see its smaller areas, then use the breadcrumb or
browser Back to move up. Each area includes a description and source links.
Maps support up to three levels, save
independently, and can be rerun, modified, duplicated, or deleted.

On the **Presentation** tab, choose **New presentation** and enter a topic to create
a source-linked slide deck. Decks include speaker notes and custom system maps,
request journeys, or module detail diagrams when useful. Navigate with the arrow
keys, use **Present** (or **F**) for fullscreen, and press **Escape** to exit.

Presentations are saved as versioned JSON alongside other analyses. Download JSON
to retain the structured content, or download a standalone HTML deck with embedded
SVG diagrams that works offline. HTML downloads include slide navigation, notes,
and source references; browser printing produces one page per slide. The Actions
menu supports rerunning, modifying, duplicating, and deleting saved decks.

## Configuration

Set environment variables when starting the server:

```sh
CODESCOPE_DATA_DIR="/path/to/data" PORT=4311 npm start
```

- `CODESCOPE_DATA_DIR`: saved projects and analyses; defaults to `.codescope/`.
- `CODESCOPE_CODEX_BIN`: path to Codex; defaults to `codex`.
- `PORT`: local port; defaults to `4310`.

Open **Settings** in the toolbar to see and copy the active data folder.
Project paths are stored in `<data directory>/projects.json`. Source files stay
in their original folders. Copy the existing data directory's contents to keep
saved projects and analyses when changing its location.

## Source and privacy

- Analysis sends filtered source to OpenAI through Codex.
- Scanning respects `.gitignore` and `.codescopeignore` in the project being analyzed.
- Hidden files and common key files are excluded from scanning.
- CodeScope does not modify your source.
- Saved job history includes source snapshots and prompts.
- The default `.codescope/` data directory is gitignored.

## Development

```sh
npm run dev    # Restart on server changes
npm run check  # Syntax checks
npm test       # Tests use a simulated CLI; no model usage
```

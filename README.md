<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/images/logo-light.svg">
    <img src="docs/images/logo-dark.svg" alt="CodeScope" width="448" height="96">
  </picture>
</h1>

<p align="center">
  CodeScope uses the Codex CLI to turn a local repository into diagrams and walkthroughs.
  Follow a request across components, then open the source lines behind each step in your browser.
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

**[Explore the live demo](https://pminkov.github.io/codescope-demo/)**

![Architecture diagram 02 showing ProjectStore, the project registry, saved analyses, and job history][ui]

## Analyses

| View | What you can explore |
| --- | --- |
| [Directories][directories] | Browse the folder tree to learn what each directory contains and which file to read first. |
| [Code Scan][code-scan] | See line counts by file and jump to class, method, and function declarations in supported languages. |
| [Architecture][architecture] | Map the components of a system or subsystem and select one to inspect its dependencies and source. |
| [Areas][areas] | Break a feature or service into smaller responsibilities and find the source files that implement each one. |
| [Code flows][flows] | Trace a single action from its entry point through function calls, branches, and side effects. |
| [Nouns][nouns] | Look up the project's domain concepts to see what each one means, what it does, and how it relates to the others. |
| [Sequences][sequences] | Follow the order of calls, replies, and asynchronous handoffs between participants in an interaction. |
| [Endpoints][endpoints] | Look up REST routes by server, HTTP method, and path, then inspect each route's handler, request, and response. |
| [Presentation][presentations] | Turn a topic into a slide deck with diagrams, speaker notes, and references to the code. |

Open [All][all] to revisit saved analyses, newest first. In the local app, use
**Ask** for follow-up questions about the current view, such as “Where is a
completed analysis saved?” Answers link to the relevant lines of code.

## Run

Install Node.js 22 or later and the [Codex CLI](https://developers.openai.com/codex/cli/).
Make sure `codex` is on your `PATH`.

```sh
git clone https://github.com/pminkov/codescope.git
cd codescope
npm ci
codex login
npm start
```

Open [127.0.0.1:4310](http://127.0.0.1:4310) and choose **Add project**. Select
the `codescope` folder you just cloned, or paste the absolute path to another
project. Choose **Add and analyze** to generate a directory guide and an
architecture overview.

## Working with saved analyses

In **Areas**, choose **New area map**, enter a feature or subsystem (or leave the
scope blank for the whole project), and choose **Map areas**. Open an area to
explore up to three levels of detail. Use the breadcrumb to return to its parent.

In **Presentation**, choose **New presentation** and enter a topic. Use the arrow
keys to advance slides, **F** to present fullscreen, and **Escape** to exit.
Download a deck as versioned JSON or as standalone HTML with embedded diagrams,
speaker notes, and source references. The HTML deck works offline and prints one
slide per page.

Use **Actions** to rerun, modify, duplicate, or delete a saved map or deck.
To share a project like the live demo, choose which source files to include and
[export the saved analyses as a static site](scripts/export-demo.md).

## Configuration

Set environment variables when starting the server.

```sh
CODESCOPE_DATA_DIR="/path/to/data" PORT=4311 npm start
```

- `CODESCOPE_DATA_DIR` sets the folder for saved projects and analyses (default `.codescope/`).
- `CODESCOPE_CODEX_BIN` selects the Codex executable (default `codex`).
- `PORT` sets the local port (default `4310`).

Open **Settings** in the toolbar to see and copy the active data folder.
CodeScope records each project's source path in `<data directory>/projects.json`.
To move your saved projects and analyses, copy the data folder's contents to the
new location when changing `CODESCOPE_DATA_DIR`.

## Source and privacy

CodeScope treats the selected project's source files as read-only. Scanning
respects `.gitignore` and `.codescopeignore` and skips hidden files and common
key files. When you generate an analysis or use **Ask**, the Codex CLI sends
filtered source to OpenAI.

Saved job history includes source snapshots and prompts. The default
`.codescope/` data directory is gitignored.

## Development

```sh
npm run dev    # Restart on server changes
npm run check  # Syntax checks
npm test       # Tests use a simulated Codex CLI
```

[ui]: docs/images/codescope-architecture.png
[directories]: https://pminkov.github.io/codescope-demo/#/directories
[code-scan]: https://pminkov.github.io/codescope-demo/#/code-scan
[architecture]: https://pminkov.github.io/codescope-demo/#/architecture
[areas]: https://pminkov.github.io/codescope-demo/#/areas
[flows]: https://pminkov.github.io/codescope-demo/#/flows
[nouns]: https://pminkov.github.io/codescope-demo/#/nouns
[sequences]: https://pminkov.github.io/codescope-demo/#/sequences
[endpoints]: https://pminkov.github.io/codescope-demo/#/endpoints
[presentations]: https://pminkov.github.io/codescope-demo/#/presentations
[all]: https://pminkov.github.io/codescope-demo/#/all

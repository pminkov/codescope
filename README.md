# CodeScope

Explore a codebase with directory explanations, architecture and sequence diagrams,
code flows, and answers linked to source. Runs locally using the Codex CLI.

## Run

Requires Node.js 22+ and the Codex CLI on your PATH.

```sh
git clone https://github.com/pminkov/codescope.git
cd codescope
npm ci
codex login
npm start
```

Open [127.0.0.1:4310](http://127.0.0.1:4310), choose **Add project**, and select
or paste a folder path.

## Configuration

Set environment variables when starting the server:

```sh
CODESCOPE_DATA_DIR="/path/to/data" PORT=4311 npm start
```

- `CODESCOPE_DATA_DIR`: saved projects and analyses; defaults to `.codescope/`.
- `CODESCOPE_CODEX_BIN`: path to Codex; defaults to `codex`.
- `PORT`: local port; defaults to `4310`.

Project paths are stored in `<data directory>/projects.json`. Source files stay
in their original folders. Copy the existing data directory's contents to keep
saved projects and analyses when changing its location.

## Source and privacy

Analysis sends filtered source to OpenAI through Codex. Scanning respects
`.gitignore` and `.codescopeignore`, and excludes hidden files and common key files.
CodeScope does not modify your source. Saved job history includes source snapshots
and prompts; the default `.codescope/` directory is gitignored.

## Development

```sh
npm run dev    # Restart on server changes
npm run check  # Syntax checks
npm test       # Tests use a simulated CLI; no model usage
```

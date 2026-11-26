# Export a static demo

From the repository root, export one saved project by its ID (the segment after
`/projects/` in its local URL). Include `--full-source` to let visitors open
every readable file and jump from a Code Scan symbol to its declaration.

```sh
npm run export-demo -- --project codescope --out ./drafts/demo --full-source
```

Upload the contents of the output directory to a static host, or preview it with
`python3 -m http.server 8000 --directory ./drafts/demo` and open
[localhost:8000](http://localhost:8000/). The demo opens on the saved architecture
overview when available. Tabs, diagrams, and slides work in the browser. Fragment
links support direct visits and refreshes even when hosted under a subdirectory.

The snapshot includes the project's directory and symbol inventories and saved
analysis text. Full-source exports store the text that CodeScope can preview
under `sources/`. The browser loads each file when a visitor opens it. The
project's ignore rules and the app's 1 MB per-file preview limit apply.

For a smaller export, omit `--full-source`. You can repeat `--source` with a
project-relative path to include just the resolved citations from that file.

```sh
npm run export-demo -- --project codescope --out ./drafts/demo --source src/server.mjs
```

Visitors can open analysis forms and type questions in Ask. Submitting either
shows a read-only notice and keeps their draft available. The exporter reads
the same `CODESCOPE_DATA_DIR` as the app and leaves the registry and jobs alone.
Rerun the command to refresh a dedicated demo directory. Each export replaces
the previous snapshot and its source previews. Reload an open demo tab to see
the new export.

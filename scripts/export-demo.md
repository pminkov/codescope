# Export a static demo

From the repository root, export one saved project by its ID (the segment after
`/projects/` in its local URL).

```sh
npm run export-demo -- --project codescope --out ./drafts/demo
```

Upload the contents of the output directory to a static host, or preview it with
`python3 -m http.server 8000 --directory ./drafts/demo` and open
[localhost:8000](http://localhost:8000/). The demo opens on the saved architecture
overview when available. Tabs, diagrams, and slides work in the browser. Fragment
links support direct visits and refreshes even when hosted under a subdirectory.

The snapshot includes the project's directory and symbol inventories and saved
analysis text. Source previews are opt-in. Repeat `--source` with a project-relative
path to include the currently resolved cited lines from that file.

```sh
npm run export-demo -- --project codescope --out ./drafts/demo --source src/server.mjs
```

Visitors can open analysis forms and type questions in Ask. Submitting either
shows a read-only notice and keeps their draft available. The exporter reads
the same `CODESCOPE_DATA_DIR` as the app and leaves the registry and jobs alone.
Rerun the command to refresh a dedicated demo directory. Each export replaces
the previous snapshot, including its selection of source excerpts.

## Cursor Cloud specific instructions

### Project overview

This is a zero-dependency, no-build static web project — a **ChatGPT History Exporter** browser tool. It consists of:

- `chatgpt-export.js` — a ~1,500-line vanilla JS script meant to be pasted into the browser console on `chatgpt.com`
- `launcher.html` — a self-contained HTML landing page that lets users copy the export script to clipboard

There is no package manager, no build system, no test framework, and no linting configured.

### Running locally

Serve the repository root with any static HTTP server. The launcher page fetches `chatgpt-export.js` via a relative URL, so it must be served over HTTP (not `file://`).

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080/launcher.html` in Chrome.

### Testing

There are no automated tests. Manual testing requires a logged-in ChatGPT session at `chatgpt.com` — paste the script into the browser console and interact with the exporter panel. The launcher page's copy buttons can be tested locally without a ChatGPT session.

### Notes

- The `chatgpt-export/` subdirectory contains duplicates of the root-level files.
- The CSV files in the repo root are unrelated sample data.

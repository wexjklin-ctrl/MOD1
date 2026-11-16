# Workflow for a continuing Claude session
1. `git clone https://github.com/wexjklin-ctrl/MOD1` (public repo). Pass any PAT only via `git -c http.extraheader=…`; never write it to `.git/config` or files.
2. Download release `1` asset `RZ5t.mcaddon`, check sha256, `unzip`.
3. `node tools/scan_js.mjs <BP/scripts> catalog.json`; `python3 tools/build_docs.py <addon_root> catalog.json docs/_generated`; `python3 tools/annotate.py …` (see tool headers). `npm i acorn acorn-walk` first.
4. Read `00_START_HERE.md` honesty table, pick a row marked INDEXED ONLY, read it, then update docs.
5. Verify annotation round trip: `strip_annotations.py` → `diff -r` with original.

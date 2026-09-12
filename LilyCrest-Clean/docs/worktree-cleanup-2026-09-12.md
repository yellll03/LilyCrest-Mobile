# Worktree cleanup — 12 September 2026

The full modified/untracked file inventory was captured from both Git roots before cleanup and classified as RELATED, UNRELATED USER WORK, or GENERATED/TEMPORARY. Scoped ignored task outputs were inventoried as well. No source code or tests were changed by cleanup, and nothing was staged, committed, merged, or deployed.

## Before and after

Counts use `git status --porcelain=v1 --untracked-files=all`, counting files rather than collapsed directory entries. The mobile Git root is `D:/LilyCrest`; the application is its `LilyCrest-Clean` subdirectory.

| Worktree | Before modified | Before untracked | After modified | After untracked | Final total |
| --- | ---: | ---: | ---: | ---: | ---: |
| Mobile | 28 | 404 | 28 | 20 | 48 |
| Canonical API/admin website | 13 | 98 | 14 | 42 | 56 |
| Combined | 41 | 502 | 42 | 62 | 104 |

The final files comprise 57 related feature/cleanup files and 47 preserved unrelated files. The website's extra modified file is its narrowly scoped `.gitignore` update. The mobile final count includes this cleanup report.

## Kept for this feature

All 52 implementation and regression-test files across mobile and canonical API/admin remain. The audit report, updated feature manifest, cleanup report, and two ignore-rule files remain as documentation/housekeeping. See [feature manifest](mobile-audit-changed-files.txt). All retained implementation/test and unrelated-user-work hashes matched the pre-cleanup inventory; only the explicitly updated audit documentation/ignore rules changed.

## Removed from the worktrees

913 individually inventoried files, totaling 161,987,849 bytes (154.48 MiB): 527 from mobile and 386 from the website. This includes 441 previously visible untracked files and 472 ignored generated files.

- 352 user-guide intermediates: 244 extracted images, 10 contact sheets, 2 extracted reference texts, 86 intermediate page/PDF renders, and 10 website-reference page/text extracts. Every extracted DOCX image was SHA-256 verified against media embedded in the retained source DOCX files. The extraction/render scripts were inspected; source documents, final guides, and the original website-reference PDF remain available.
- Current-task screenshot/test/log evidence and temporary browser fixture/scripts. Their permanent regression tests remain in the source tree. The audit report now points to the evidence archive instead of removed local files.
- Reproducible Expo native export files and the website Vite build output.
- Prior water-fixture screenshots, sample/stress PDFs, extracted text, runtime logs, and prior generated command logs. Authored harnesses, tests, findings, and uncertain JSON evidence were preserved.

469 evidence/temporary files were first copied outside both repositories and verified by SHA-256. The other 444 files were reproducible native/web build outputs. All deletions used exact inventory paths, checked root containment, and rechecked hashes immediately before removal. No blanket `git clean`, reset, restore, or recursive file deletion was used.

## Unrelated user work intentionally preserved

- Mobile: both original UnitTesting DOCX files; both final guide DOCX/PDF pairs; `build_guide.py`, `extract.py`, `render_docx.py`, `restyle_guide.py`; and the two authored guide review JSON files (12 files).
- Website: prior water QA source/test harnesses and findings, uncertain historical JSON evidence, the monthly utility audit report, three final guide PDFs, prior PR operational notes/scripts/results, and three existing server audit scripts (35 files).

These files remain visible and unstaged. They are excluded from the feature manifest. In particular, final PDFs/DOCX files were not treated as disposable merely because their formats are often generated. Historical JSON evidence was left untouched where its ongoing review value was uncertain.

## Ignore rules

`docs/.gitignore` now covers specific extracted DOCX media/contact-sheet names, intermediate render directories, and reproducible mobile audit screenshots/results. It does not ignore authored guide scripts/review notes or final guide deliverables.

The website `.gitignore` now covers `.water-visual-qa` generated screenshot/PDF paths and specific runtime/extracted-text patterns. It does not hide the prior harnesses, tests, findings, or uncertain JSON records. Existing build/log ignore rules remain. Representative generated paths matched `git check-ignore`; preserved source/guide paths did not.

## Evidence and checks

The external evidence directory is `D:/LilyCrest-Task-Review/2026-09-12-cleanup/`:

- [Mobile before status](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/mobile-status-before.txt) and [after status](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/mobile-status-after.txt).
- [Website before status](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/website-status-before.txt) and [after status](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/website-status-after.txt).
- [Full classified before inventory](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/classified-inventory-before.csv), [final classified inventory](/D:/LilyCrest-Task-Review/2026-09-12-cleanup/classified-inventory-after.csv), and `removed-files.json` contain exact paths, classifications, decisions, sizes, and hashes.
- `evidence/mobile/LilyCrest-Clean/docs/` holds the mobile test logs/results and screenshots. The archived temporary fixture source is alongside it under `tools/`. Prior unrelated generated evidence is retained under its original relative path in `evidence/mobile/` or `evidence/website/`.

Both repositories passed `git diff --check`. Source/tests were unchanged, so test suites were not rerun for this filesystem/documentation cleanup. Existing dependency caches, credentials/configuration, and unrelated ignored runtime data were untouched.

Automatic approval review blocked the optional empty-directory removal with “blocked by policy.” Empty directories were left in place; they contain no removed artifacts and Git does not track them.

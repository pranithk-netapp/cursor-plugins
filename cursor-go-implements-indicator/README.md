# Cursor Go Implements Indicator

Clickable Go interface implementation indicators and inline Go test coverage for Cursor/VS Code.

This extension adds two lightweight affordances on interface methods:

- A CodeLens above each method (for example `3 implementations`)
- An inline clickable hint near the method (for example `🟢 3 impl`)

Both actions open the standard implementations peek panel.

It also supports inline Go unit-test coverage colors from `coverage.out`:

- Green: full coverage on the line
- Yellow: partial coverage on the line
- Red: no coverage on the line


## Features

- Finds implementations via `vscode.executeImplementationProvider` (typically powered by `gopls`)
- Supports `Location` and `LocationLink` responses
- Deduplicates results before opening peek
- Includes fallback query positions for better reliability on method signatures
- Adds an editor context menu action: **Show Go Implementations**
- Watches `coverage.out` and colors Go lines inline with coverage status
- Adds command: **Run Go Unit Tests With Coverage** (`go test ./... -covermode=count -coverprofile=coverage.out`)
- Adds command: **Generate coverage.out from GOCOVERDIR (covdata)** for integration-test coverage workflows
- Adds command: **Clear Go Coverage Decorations**

## Requirements

- Go extension installed
- `gopls` installed and working
- Open a valid Go module/workspace so implementation lookups resolve correctly

## Install From VSIX

1. Open Command Palette with `Cmd+Shift+P`.
2. Run `Extensions: Install from VSIX...`.
3. Select the generated package file:
   - `cursor-go-implements-indicator-0.1.0.vsix`
4. Complete the install prompt.
5. Reload Cursor using `Developer: Reload Window` from Command Palette.

## Usage

1. Open a Go file with interface methods.
2. Click either:
   - the CodeLens (`N implementations`), or
   - the inline hint (`🟢 N impl`).
3. Peek implementations opens with clickable results.

You can also use:

- Command Palette: `Show Go Implementations`
- Editor context menu: `Show Go Implementations` (cursor on interface method)

### Coverage usage

1. Open a Go file in your workspace.
2. Run command: **Run Go Unit Tests With Coverage**.
3. The extension generates/updates `coverage.out` in workspace root and decorates matching Go lines:
   - green = fully covered
   - yellow = partially covered
   - red = uncovered
4. Re-run coverage command any time to refresh highlights.

If you run tests manually with a `-coverprofile=coverage.out`, the watcher also updates highlights automatically.

### Integration-test coverage (Go 1.20+)

This extension also supports the official Go integration coverage flow:

1. Build/run integration tests with coverage and write raw data into `GOCOVERDIR`.
2. Run command: **Generate coverage.out from GOCOVERDIR (covdata)**.
3. The extension runs `go tool covdata textfmt -i=<dir> -o=coverage.out` and refreshes inline colors.

Reference: [Go blog - Code coverage for Go integration tests](https://go.dev/blog/integration-test-coverage)

## Notes

- VS Code/Cursor gutter decoration icons are not clickable by API design.
- This extension intentionally uses clickable inline hints and CodeLens instead.
- If results are empty, verify `gopls` is healthy and the workspace/module is fully loaded.

## Quick Troubleshooting

- **No CodeLens or inline hints**
  - Ensure the file language is Go.
  - Check Cursor setting `Editor: Code Lens` is enabled.
  - Check Cursor setting `Editor: Inlay Hints` is enabled.
- **No implementations found**
  - Test built-in command `Go to Implementations` on the same method.
  - Reopen the project from the module root (where `go.mod` is discoverable).
- **Extension not loading after install**
  - Run `Developer: Reload Window`.
  - Reinstall the latest VSIX.

## Development

```bash
npm install
npm run compile
npm test
npm run package
```


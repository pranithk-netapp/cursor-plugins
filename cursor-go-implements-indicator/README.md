# Cursor Go Implements Indicator

Clickable Go interface implementation indicators for Cursor/VS Code.

This extension adds two lightweight affordances on interface methods:

- A CodeLens above each method (for example `3 implementations`)
- An inline clickable hint near the method (for example `🟢 3 impl`)

Both actions open the standard implementations peek panel.


## Features

- Finds implementations via `vscode.executeImplementationProvider` (typically powered by `gopls`)
- Supports `Location` and `LocationLink` responses
- Deduplicates results before opening peek
- Includes fallback query positions for better reliability on method signatures
- Adds an editor context menu action: **Show Go Implementations**

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


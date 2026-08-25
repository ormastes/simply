# Debugging Examples

These examples demonstrate the Simple language's DAP debugging features.

## Quick Start

1. Open VS Code in the Simple repository
2. Open any `.spl` file in this directory
3. Press **F5** to start debugging
4. Set breakpoints by clicking in the gutter (left margin)

## Examples

### `factorial_debug.spl`

Demonstrates recursive function debugging:
- Set breakpoints inside recursive calls
- Step into/out of function calls
- Inspect variables at each level
- View call stack during recursion

**Try This:**
1. Set breakpoint on line 13 (inside `factorial`)
2. Run with F5
3. Press F11 (Step Into) to follow the recursion
4. Watch the call stack grow and shrink
5. Inspect `n` and `result` variables

### More Examples Coming Soon

- `async_debug.spl` - Debugging async/await code
- `error_handling_debug.spl` - Debugging error propagation
- `collection_debug.spl` - Inspecting arrays, dicts, structs
- `multithread_debug.spl` - Debugging concurrent code

## Debugging Tips

### 1. Use Conditional Breakpoints

Right-click on a breakpoint and select "Edit Breakpoint" to add a condition:
```
x > 100
```

### 2. Watch Variables

Add variables to the Watch pane to track their values across execution.

### 3. Debug Console

Use the Debug Console to evaluate expressions while stopped:
```
> x + y
84
> user.name
"Alice"
```

### 4. Call Stack Navigation

Click on any frame in the Call Stack pane to jump to that location and see its variables.

### 5. Restart Debugging

Press Ctrl+Shift+F5 to restart the debugging session from the beginning.

## Common Issues

**Breakpoints Not Hitting?**
- Make sure debug mode is enabled
- Check that the file path matches exactly
- Verify the code is actually being executed

**Variables Not Showing?**
- Variables are only visible when execution is paused
- Step to the line after the variable is defined
- Check that you're viewing the correct scope (Local vs Global)

**Performance Slow?**
- Debugging adds ~5-10% overhead
- Remove breakpoints you're not using
- Use "Continue" (F5) instead of stepping through large sections

## Next Steps

- Read the [DAP Debugging Guide](../../doc/guide/dap_debugging_guide.md)
- Try debugging your own Simple programs
- Report any issues on GitHub

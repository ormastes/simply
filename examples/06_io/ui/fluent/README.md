# Fluent Method Modifiers — Phase 3 UI Typed Core RFC

This directory demonstrates the method-style modifiers added to `WidgetNode` in Phase 3.
All `with_*` free functions from `builder.spl` continue to work unchanged (marked legacy).

## New method API

Instead of calling the free function:

```
var btn = button("save", "Save")
btn = with_width(btn, 120)
btn = with_background(btn, "primary")
```

You can call the equivalent method directly on `WidgetNode`:

```
var btn = button("save", "Save")
btn = btn.width(120)
btn = btn.background("primary")
```

## Chain-syntax limitation

**NOTE: chain syntax (`node.width(120).height(40)`) requires Phase 9 chain-fix RFC; until then, use intermediate var:**

```
# WRONG — does not compile until Phase 9
var btn = button("save", "Save").width(120).height(40)

# CORRECT — use intermediate var for each step
var btn = button("save", "Save")
btn = btn.width(120)
btn = btn.height(40)
```

## Full method reference

| Method | Signature | Equivalent `with_*` |
|--------|-----------|---------------------|
| `flex` | `(n: i32) -> WidgetNode` | `with_flex` |
| `width` | `(w: i32) -> WidgetNode` | `with_width` |
| `height` | `(h: i32) -> WidgetNode` | `with_height` |
| `background` | `(color: text) -> WidgetNode` | `with_background` |
| `surface` | `(color: text) -> WidgetNode` | `with_surface` |
| `radius` | `(r: text) -> WidgetNode` | `with_radius` |
| `icon` | `(icon_id: text) -> WidgetNode` | `with_icon` |
| `shadow` | `(s: text) -> WidgetNode` | `with_shadow` |
| `accent` | `(color: text) -> WidgetNode` | `with_accent` |
| `set_visible_flag` | `(v: bool) -> WidgetNode` | `with_visible` |
| `selected` | `(index: i32) -> WidgetNode` | `with_selected` |
| `disabled` | `() -> WidgetNode` | `with_disabled` |
| `readonly` | `() -> WidgetNode` | `with_readonly` |
| `error` | `(message: text) -> WidgetNode` | `with_error` |
| `validator` | `(pattern: text) -> WidgetNode` | `with_validator` |
| `required` | `() -> WidgetNode` | `with_required` |
| `max_length` | `(n: i32) -> WidgetNode` | `with_max_length` |
| `tooltip` | `(tip: text) -> WidgetNode` | `with_tooltip_text` |
| `on_mount` | `(handler_id: text) -> WidgetNode` | `with_on_mount` |
| `on_unmount` | `(handler_id: text) -> WidgetNode` | `with_on_unmount` |
| `on_update` | `(handler_id: text) -> WidgetNode` | `with_on_update` |
| `on_action` | `(handler_id: text) -> WidgetNode` | `with_on_action` |
| `on_focus` | `(handler_id: text) -> WidgetNode` | `with_on_focus` |
| `on_blur` | `(handler_id: text) -> WidgetNode` | `with_on_blur` |
| `child` | `(c: WidgetNode) -> WidgetNode` | `add_child` (method) |
| `add_children` | `(cs: [WidgetNode]) -> WidgetNode` | loop over `add_child` |

## Skipped helpers (not mirrored as methods)

| Helper | Reason |
|--------|--------|
| `with_visible` | Conflicts with existing 0-arg `visible() -> bool` getter; use `set_visible_flag(v)` instead |
| `children` | Conflicts with existing 0-arg `children() -> [WidgetNode]` getter; use `add_children(cs)` instead |
| `with_profile` | Returns `ProfileSet`, not `WidgetNode`; does not fit a fluent `WidgetNode` chain |

## Migration

- Existing code using `with_*` free functions from `builder.spl` requires no changes.
- New code can use methods for a more object-oriented style.
- Both forms are tested by the wire golden tests.

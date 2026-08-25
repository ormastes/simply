# Test Results

**Generated:** 2026-03-16 01:41:52
**Total Tests:** 183
**Status:** ⚠️ 5 FAILED

## Summary

| Status | Count | Percentage |
|--------|-------|-----------|
| ✅ Passed | 178 | 97.3% |
| ❌ Failed | 5 | 2.7% |
| ⏭️ Skipped | 0 | 0.0% |
| 🔕 Ignored | 0 | 0.0% |
| 🔐 Qualified Ignore | 0 | 0.0% |

---

## 🔄 Recent Status Changes

| Test | Change | Run |
|------|--------|-----|
| extracts plain query | new_test |  |
| handles empty query | new_test |  |
| extracts tag operator | new_test |  |
| extracts path operator | new_test |  |
| extracts title operator | new_test |  |
| extracts multiple operators | new_test |  |
| extracts modified:recent | new_test |  |
| extracts linkto operator | new_test |  |
| extracts linkedfrom operator | new_test |  |
| returns false for plain query | new_test |  |
| returns true when tag filter present | new_test |  |
| returns true for modified:recent | new_test |  |
| extracts title from frontmatter | new_test |  |
| extracts tags from frontmatter list | new_test |  |
| extracts aliases from frontmatter | new_test |  |
| falls back to first heading when no title in frontmatter | new_test |  |
| handles empty content | new_test |  |
| extracts simple wikilinks | new_test |  |
| extracts wikilinks with aliases | new_test |  |
| extracts multiple wikilinks | new_test |  |

---

## ❌ Failed Tests (5)

### 🔴 creates links table

**File:** `test/01_unit/indexer_spec.spl`
**Category:** Unit
**Failed:** 
**Flaky:** No (100.0% failure rate)

---

### 🔴 creates chunks table

**File:** `test/01_unit/indexer_spec.spl`
**Category:** Unit
**Failed:** 
**Flaky:** No (100.0% failure rate)

---

### 🔴 creates notes table

**File:** `test/01_unit/indexer_spec.spl`
**Category:** Unit
**Failed:** 
**Flaky:** No (100.0% failure rate)

---

### 🔴 finds notes by title

**File:** `test/01_unit/search_engine_spec.spl`
**Category:** Unit
**Failed:** 
**Flaky:** No (0.0% failure rate)

---

### 🔴 creates tasks table

**File:** `test/01_unit/indexer_spec.spl`
**Category:** Unit
**Failed:** 
**Flaky:** No (100.0% failure rate)

---

---

## 📊 Timing Analysis

---

## 🎯 Action Items

### Priority 1: Fix Failing Tests (5)

1. **creates links table** - 
2. **creates chunks table** - 
3. **creates notes table** - 
4. **finds notes by title** - 
5. **creates tasks table** - 

### Priority 3: Stabilize Flaky Tests (26)

Tests with intermittent failures:
- treats missing notes as stale (33.3% failure rate)
- finds forward links (66.7% failure rate)
- removes a note and its dependents (66.7% failure rate)
- stores note title (50.0% failure rate)
- computes higher authority for well-linked notes (66.7% failure rate)


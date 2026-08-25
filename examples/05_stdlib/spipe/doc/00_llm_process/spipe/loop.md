# SPipe Loop — Continuous Check & Implement

Run specs repeatedly, fix failures, until all green.

## Usage
`/spipe_loop <spec_file_or_dir>`

## Workflow
1. Run `bin/simple test <target>` to get failing specs
2. For each failure:
   a. Read the spec to understand what's expected
   b. Spawn Agent to implement/fix the code
   c. Re-run the spec to verify fix
3. Loop until all specs pass (max 10 iterations)
4. Report: which specs were fixed, which remain

## Context Budget
Sub-40%. Each fix attempt is a fresh Agent call.

## Exit Criteria
- All specs pass, OR
- Max iterations (10) reached — report remaining failures

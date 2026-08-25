---
name: agents
description: Agent loop iteration patterns and multi-agent team orchestration via MCP tools
---

# Agents Skill

## Agent Loop

Iterative task loops via MCP tools. The AI client drives the loop; MCP provides bookkeeping.

### Workflow

1. `agent_loop_start(prompt, max_iterations, completion_condition, agent)` -- create loop
2. Do work (execute the prompt's task)
3. `agent_loop_step(loop_id, result)` -- report result
4. If status="active", continue. If "completed", stop.
5. `agent_loop_stop(loop_id)` -- end early

### Completion

Loop completes when: `max_iterations` reached, `completion_condition` found in result, or explicit `stop`.

State: `.build/agent_loop/loops/{id}.state`

Hook: `scripts/agent-loop-hook.shs` detects active loops and prompts continuation.

---

## Agent Team

Multi-agent coordination via MCP tools.

### Workflow

1. `agent_team_create(name, agents="coder,reviewer,tester", coordination="sequential")` -- create team
2. `agent_team_run(team_id, prompt)` -- get instruction for current agent
3. Execute instruction
4. Repeat `agent_team_run` for next agent's turn

### Coordination Strategies

| Strategy | Behavior |
|----------|----------|
| `sequential` | Agents in order, one at a time |
| `parallel` | All agents get same prompt |
| `round_robin` | Cycles through agents |

State: `.build/agent_loop/teams/{id}.state`

### Combining Loop + Team

```
agent_loop_start(prompt: "Improve code quality")
  -> agent_team_run(team_id, prompt: "Fix issues")
  -> agent_loop_step(loop_id, result: "3 issues fixed")
  -> repeat...
```

"""Auto-mode multiagent dashboard generation.

A hierarchical LangGraph pipeline that runs autonomously (no human-in-the-loop
gates) when the user clicks "Create Dashboard" on an auto-mode project:

    profiler -> cleaning -> merging -> [5 analysis lenses in parallel]
             -> visualization -> assemble (dashboard + narrative report)

Each subagent is a multihop ReAct graph (see app/agents/shared/react.py) that
reasons over SQL. The 5 analysis lenses fan out as parallel graph branches,
each on its own checkpoint thread, merging results through state reducers.
"""

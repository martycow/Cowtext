# INPUT PROMPT FOR COWTEXT

Here lives a dynamic prompt for using inside Claude Code.
Consider everything below as a new prompt every time. It may or may not change. You can't tell before you read.
Don't make changes here. Just read it and follow the rules.

=== Everything below considered as a prompt ===

08/18/2026 10:36PM

Thoughts:

1. For empty projects create mandatory context files depenting of project type
2. New project creation wizard. User specifies all the settings about the project. Depenting on selected type (Video Game, Desktop Application, SaaS etc) file/folder hierarchy is created
3. For each Agent create related file  `.claude/agents/<agent_name>.md` and agent memory files inside `.claude/agent-memory/<agent_name>/...`
4. There should be default pre-defined skills. For example, the one which formats Tasks for proper displaying later. Or skill which starts ultracode fleet session. It's OPTIONAL in wizard
5. Agent nodes on graph should look different than other nodes. It should look like it's real Agent
6. Make Agent creation wizard more customizable. There should be calculated default paths in input fields
7. Add FPS toggle in settings
8. Check performance for Barn. Framerate drops on a default scene
9. Every node is created through the wizard (even when double-clicked on graph)
10. There must be some tool set for reorganizing existing project to Cowtext hierarhy and file formats
11. Tasks format skill and TASKS, BACKLOG, BUGS, ROADMAP, CHANGELOG must be a formatted user-readable grid. There must be only brief info without verbose descriptions. ALL tasks MUST have the same format everywhere to be displayed and managed properly on Task Board. The must be ONLY grids without any else info
12. Tags for tasks must be a dropdown menu with the ability to create a new tag there
13. Priorities should be: Low, Medium, High, CRITICAL
14. BACKLOG, ROADMAP and BUGS must be somewhere else. Right now they are constantly displayed on the right.
15. I can't see Fable 5 in the model dropdown. What's "inherit"?
16. New Nodes are created in the center of current viewport on graph
17. Descriptions of roles are barely visible. Make the font a little brighter
18. Think deeper about what roles must exist
19. Each agent should have a defined Department. User can create it's own Department. The list of default departments is based on Project's type
20. Think deeply about Edge's types. For example, "Agent Task Manager" should CONTROL TASKS.md.
21. Research an ability to connect Codex, Cursor and others hooks as well as Claude Code
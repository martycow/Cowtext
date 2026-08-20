# INPUT PROMPT FOR COWTEXT

Here lives a dynamic prompt for using inside Claude Code.
Consider everything below as a new prompt every time. It may or may not change. You can't tell before you read.
Don't make changes here. Just read it and follow the rules.

=== Everything below considered as a prompt ===

## What I noticed

1. New Project Wizard
   * No "Video Game" type
   * Brief description should be limited to some adequate amount of symbols (like 1000)
   * I can't type spaces and new line in Requirements, Hard Rules and Constraints fields
   * Optional fields MUST be collapsed by default. They only appear if User needs to fill them

2. Hierarchy
   * Hierarchy should look like VSCode's hierarchy: Arrows and files are on the same line
   * When I select Agent it breaks the app's UI

3. Inspector
   * "Adapt to graph" button breaks the app's UI
   * Transform component is always on top
   * I can't scroll items in Tools dropdown

4. Agent's Properties In Inspector
   * Agent's properties must be a component as well as others
   * "Create it" button doesn't do nothing and is displayed to matter that memory file exists. There should be "Reveil in Explorer" button or "Fix" if memory file is corrupted or doesn't exist
   * Duplicates of models: Opus and Opus-5, Sonnet and Sonnet-5, Haiku and Haiky-... 
   * There MUST NOT be Save button. Every change is saved immideately
   * Remove "Delete Agent" button. Agent's management must be in Agents tab or in Hierarchy

5. General
   * Duplicated button "Add agent" on the bottom
  
6. New Node Wizard
   * I checked "Assembly after close" and after I pressed finish it crashed app's UI

## New Features

1. Home button which returns on title screen
2. Git Wizard. At least it must init git repository in the project and let User set .gitignore convinient way
3. User can select project in hierarchy and be able to see it's component properties in Inspector. Only SOME of them must be editable
4. Reveil in Explorer for Project in hierarchy
5. Add the details about agents must be in Agents tab
6. Change or upload avatars for agents
7. 
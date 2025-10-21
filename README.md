


# Planner MCP Server



A Model Context Protocol server for creating and managing plans with steps. This server helps break down complex tasks into manageable steps and track their progress.



## Features



### Plans
- Create and manage plans with descriptive names and detailed descriptions
- Each plan contains ordered steps with clear completion conditions
- Track plan progress through active steps
- Plans maintain a history of completed and failed steps
- Paginated listing of plans (10 per page), ordered by creation date (newest first)
- Automatic tracking of creation dates with user-friendly formatting (e.g., "just now", "2 hours ago", "yesterday")



### Steps
- Create specific, measurable steps with clear completion conditions
- Track step status (in_progress, completed, failed)
- Automatic step progression on completion
- Ability to handle step failures with alternative approaches



## Tools



### `create_plan`
Creates a new plan with a descriptive name and description.
- **Parameters:**
  - `name`: string - Name of the plan
  - `description`: string - Detailed description of the plan and its objectives
- **Returns:** Plan details including ID, name, description, and status



### `list_plans`
Lists all available plans with their current status and active steps, ordered by creation date (newest first). Results are paginated with 10 plans per page. Returns a helpful message if no plans exist.
- **Parameters:**
  - `page`: number (optional) - Page number to retrieve (1-based, defaults to 1)
- **Returns:**
  - Array of plans with their details (or a message if no plans exist)
  - Current page number
  - Total number of pages
  - Whether there is a next page available



### `create_step`
Adds a new step to a plan. Steps should be specific, measurable actions that contribute to the plan's completion.
- **Parameters:**
  - `plan_id`: string - ID of the plan
  - `description`: string - Step description
  - `completion_condition`: string - Clear condition that must be met to consider this step complete
- **Returns:** Created step details



### `get_active_step`
Gets the current active step of a plan.
- **Parameters:**
  - `plan_id`: string - ID of the plan
- **Returns:** Active step details if exists



### `complete_step`
Marks a step as completed and automatically advances to the next step.
- **Parameters:**
  - `step_id`: string - ID of the step to complete
- **Returns:** Next step details if available



### `fail_step`
Marks the current active step as failed and creates a new alternative step.
- **Parameters:**
  - `step_id`: string - ID of the active step to mark as failed
  - `new_step_description`: string - Description of the new alternative step
  - `new_step_completion_condition`: string - Completion condition for the new alternative step
- **Returns:** Failed step ID and new step details
- **Note:** Can only fail the current active step



### `list_steps`
Lists all steps in a plan in their execution order.
- **Parameters:**
  - `plan_id`: string - ID of the plan
- **Returns:** Array of steps with their details



### `export_plan`
Exports a plan to markdown format including all steps and their status. The output will be formatted as a markdown document suitable for sharing or documentation purposes.
- **Parameters:**
  - `plan_id`: string - ID of the plan to export
- **Returns:**
  - Object containing:
    - `markdown`: string - Markdown formatted content of the exported plan
    - Includes plan details, status, and all steps with their descriptions and completion conditions
    - Steps are ordered by their execution sequence



## Database Schema



### Plans Table
- `id`: TEXT PRIMARY KEY
- `name`: TEXT NOT NULL
- `description`: TEXT NOT NULL
- `created_at`: DATETIME
- `active_step_id`: TEXT

### Steps Table
- `id`: TEXT PRIMARY KEY
- `plan_id`: TEXT NOT NULL
- `description`: TEXT NOT NULL
- `completion_condition`: TEXT NOT NULL
- `status`: TEXT (in_progress, completed, failed)
- `step_order`: INTEGER NOT NULL
- `created_at`: DATETIME
- FOREIGN KEY(plan_id) REFERENCES plans(id)

## Development

### Installation
```bash
npm install
```

### Build
```bash
npm run build
```

### Development Watch Mode
```bash
npm run watch
```

### Debugging
Use the MCP Inspector:
```bash
npm run inspector
```

## Best Practices

### Creating Plans
- Provide clear, descriptive names
- Include detailed descriptions of objectives
- Break down into multiple specific steps
- Avoid creating plans with single steps

### Creating Steps
- Make steps specific and measurable
- Define clear completion conditions
- Keep steps focused on single objectives
- Use testable completion conditions (e.g., "API endpoint returns 200 status code")

### Managing Progress
- Complete steps only when completion conditions are met
- When a step fails, provide a clear alternative approach
- Review step history to identify patterns in successes and failures

## Contribution Guidelines

1. Fork the repository
2. Create a feature branch
3. Submit a pull request
4. Include tests for new features
5. Update documentation
6. Follow existing code style

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { PlannerDatabase } from './database.js';
import { formatDate } from './utils.js';

interface ExportPlanArgs {
  plan_id: string;
}

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
  outputSchema: object;
}

interface CreatePlanArgs {
  name: string;
  description: string;
}

interface CreateStepArgs {
  plan_id: string;
  description: string;
  completion_condition: string;
}

interface GetActiveStepArgs {
  plan_id: string;
}

interface CompleteStepArgs {
  step_id: string;
  completion_context: string;
}

interface FailStepArgs {
  step_id: string;
  new_step_description: string;
  new_step_completion_condition: string;
}

interface ListStepsArgs {
  plan_id: string;
}

interface ListPlansArgs {
  page?: number;
}

class PlannerServer {
  private server: Server;
  private db: PlannerDatabase;
  private tools: ToolDefinition[];

  constructor() {
    this.tools = [
      {
        name: 'export_plan',
        description: 'Export a plan to markdown format including all steps and their status. The output will be formatted as a markdown document suitable for sharing or documentation purposes.',
        inputSchema: {
          type: 'object',
          properties: {
            plan_id: {
              type: 'string',
              description: 'ID of the plan to export',
            },
          },
          required: ['plan_id'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            markdown: {
              type: 'string',
              description: 'Markdown formatted content of the exported plan',
            },
          },
        },
      },
      {
        name: 'create_plan',
        description: 'Create a new plan with a descriptive name and description. You should use this tool if the user asks you to create a new plan. Ask some questions to the user to get more information about the plan. Make sure to create a few steps to start with. Avoid creating a plan with a single step.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name of the plan',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the plan and its objectives',
            },
          },
          required: ['name', 'description'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
          },
        },
      },
      {
        name: 'list_plans',
        description:
          'List all available plans with their current status and active steps. Results are paginated (10 items per page) and ordered by creation date (newest first). Returns a message if no plans exist. Each plan includes metadata about its creation time and progress. Use this tool if the user asks you to continue working on a plan and they only mention the name of the plan to find it.',
        inputSchema: {
          type: 'object',
          properties: {
            page: {
              type: 'number',
              description: 'Page number (1-based). Defaults to 1.',
            },
          },
          required: [],
        },
        outputSchema: {
          type: 'object',
          properties: {
            plans: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                  status: { type: 'string' },
                },
              },
            },
            current_page: { type: 'number' },
            total_pages: { type: 'number' },
            has_next_page: { type: 'boolean' },
          },
        },
      },
      {
        name: 'create_step',
        description:
          'Create a new step in a plan. Steps should be specific and detailed, measurable actions that contribute to the plan\'s completion. The completion condition should be clear and testable (e.g., "API endpoint returns 200 status code" or "User can log in with new credentials").',
        inputSchema: {
          type: 'object',
          properties: {
            plan_id: {
              type: 'string',
              description: 'ID of the plan this step belongs to',
            },
            description: {
              type: 'string',
              description: "Detailed description of the step's objective",
            },
            completion_condition: {
              type: 'string',
              description: 'Clear condition that must be met to consider this step complete',
            },
          },
          required: ['plan_id', 'description', 'completion_condition'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            completion_condition: { type: 'string' },
          },
        },
      },
      {
        name: 'get_active_step',
        description:
          'Get the current active step of a plan, including its description and completion condition. Use this to continue work on an existing plan or to understand what needs to be done next.',
        inputSchema: {
          type: 'object',
          properties: {
            plan_id: {
              type: 'string',
              description: 'ID of the plan to check',
            },
          },
          required: ['plan_id'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            completion_condition: { type: 'string' },
          },
        },
      },
      {
        name: 'complete_step',
        description:
          'Mark a step as completed when its completion condition has been met. This will automatically advance to the next step in the plan. Use this to track progress and maintain an accurate view of what remains to be done.',
        inputSchema: {
          type: 'object',
          properties: {
            step_id: {
              type: 'string',
              description: 'ID of the step to mark as complete',
            },
            completion_context: {
              type: 'string',
              description: 'Summary of changes made during step execution',
            },
          },
          required: ['step_id'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            description: { type: 'string' },
            completion_condition: { type: 'string' },
          },
        },
      },
      {
        name: 'fail_step',
        description:
          'Mark the current active step as failed and create a new alternative step that will be set as the active step. The new step will be inserted immediately after the failed step. Only the current active step can be marked as failed.',
        inputSchema: {
          type: 'object',
          properties: {
            step_id: {
              type: 'string',
              description: 'ID of the active step to mark as failed',
            },
            new_step_description: {
              type: 'string',
              description: 'Description of the new alternative step',
            },
            new_step_completion_condition: {
              type: 'string',
              description: 'Completion condition for the new alternative step',
            },
          },
          required: ['step_id', 'new_step_description', 'new_step_completion_condition'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            failed_step_id: { type: 'string' },
            new_step: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                description: { type: 'string' },
                completion_condition: { type: 'string' },
              },
            },
          },
        },
      },
      {
        name: 'list_steps',
        description:
          'List all steps in a plan in their execution order, including completed and failed steps. Useful for reviewing progress, understanding the plan structure, and identifying patterns in successful or failed steps.',
        inputSchema: {
          type: 'object',
          properties: {
            plan_id: {
              type: 'string',
              description: 'ID of the plan to list steps for',
            },
          },
          required: ['plan_id'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  description: { type: 'string' },
                  completion_condition: { type: 'string' },
                },
              },
            },
          },
        },
      },
    ];

    this.server = new Server(
      {
        name: 'Planner',
        version: '0.1.0',
        description: 'MCP server for creating and managing plans',
      },
      {
        capabilities: {
          resources: {},
          tools: Object.fromEntries(
            this.tools.map(tool => [
              tool.name,
              {
                description: tool.description,
                inputSchema: tool.inputSchema,
                outputSchema: tool.outputSchema,
              },
            ]),
          ),
        },
      },
    );

    this.db = new PlannerDatabase('./data.db');
    this.setupToolHandlers();

    // Error handling
    this.server.onerror = error => console.error('[Planner Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private validateArgs<T>(args: unknown, requiredProps: (keyof T)[]): asserts args is T {
    if (!args || typeof args !== 'object') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Invalid arguments. Please provide an object with the required properties.'
      );
    }
    for (const prop of requiredProps) {
      if (!(prop in args)) {
        throw new McpError(
          ErrorCode.InvalidParams,
          `Missing required property: ${String(prop)}. Please include this property and try again.`
        );
      }
    }
  }

  private async handleCreatePlan(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    this.validateArgs<CreatePlanArgs>(args, ['name', 'description']);
    const typedArgs = args as CreatePlanArgs;

    try {
      const plan = await this.db.createPlan(typedArgs.name, typedArgs.description);
      return {
        content: [
          {
            type: 'text',
            text: `Created plan "${plan.name}" with ID: ${plan.id}\nDescription: ${plan.description}\n\nNow use create_step to add multiple steps to this plan. Remember to break down the plan into specific, measurable steps.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to create plan: ${message}`);
    }
  }

  private async handleListPlans(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    const typedArgs = args as ListPlansArgs;
    const page = typedArgs.page || 1;

    try {
      const { plans, total } = await this.db.listPlans(page, 10);
      const totalPages = Math.ceil(total / 10);
      const hasNextPage = page < totalPages;

      if (total === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No plans found. Use create_plan to create a new plan.',
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `${plans
              .map(
                plan =>
                  `Plan "${plan.name}" (ID: ${plan.id})${
                    plan.active_step_id ? ' - Has active step' : ''
                  }\nDescription: ${plan.description}\nCreated: ${formatDate(plan.created_at)}`,
              )
              .join('\n\n')}\n\nPage ${page} of ${totalPages}${
              hasNextPage ? ' (use page: ' + (page + 1) + ' to see more)' : ''
            }`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to list plans: ${message}`);
    }
  }

  private async handleCreateStep(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    this.validateArgs<CreateStepArgs>(args, ['plan_id', 'description', 'completion_condition']);
    const typedArgs = args as CreateStepArgs;

    try {
      const step = await this.db.createStep(
        typedArgs.plan_id,
        typedArgs.description,
        typedArgs.completion_condition,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Created step with ID: ${step.id}\nDescription: ${step.description}\nCompletion condition: ${step.completion_condition}\n\nUse create_step to add more steps, or get_active_step to begin working on the plan.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to create step: ${message}`);
    }
  }

  private async handleGetActiveStep(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    this.validateArgs<GetActiveStepArgs>(args, ['plan_id']);
    const typedArgs = args as GetActiveStepArgs;

    try {
      const step = await this.db.getActiveStep(typedArgs.plan_id);
      return {
        content: [
          {
            type: 'text',
            text: step
              ? `Active step ID: ${step.id}\nDescription: ${step.description}\nCompletion condition: ${step.completion_condition}` +
                (step.completion_context && step.status === 'completed'
                  ? `\nCompletion Context: ${step.completion_context}`
                  : '')
              : 'No active step found',
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to get active step: ${message}`);
    }
  }

  private async handleCompleteStep(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    this.validateArgs<CompleteStepArgs>(args, ['step_id']);
    const typedArgs = args as CompleteStepArgs;

    try {
      const nextStep = await this.db.completeStep(typedArgs.step_id, typedArgs.completion_context);
      return {
        content: [
          {
            type: 'text',
            text: nextStep
              ? `Step completed. Next step:\nID: ${nextStep.id}\nDescription: ${nextStep.description}\nCompletion condition: ${nextStep.completion_condition}.`
              : `Step completed. No more steps in the plan. Use create_step if you need to add more steps to continue the plan, if unsure you can ask the user for more steps.`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to complete step: ${message}`);
    }
  }

  private async handleFailStep(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    this.validateArgs<FailStepArgs>(args, ['step_id', 'new_step_description', 'new_step_completion_condition']);
    const typedArgs = args as FailStepArgs;

    try {
      const result = await this.db.failStep(
        typedArgs.step_id,
        typedArgs.new_step_description,
        typedArgs.new_step_completion_condition,
      );
      return {
        content: [
          {
            type: 'text',
            text: `Step ${result.failed_step_id} marked as failed.\nCreated new step ${result.new_step.id}:\nDescription: ${result.new_step.description}\nCompletion condition: ${result.new_step.completion_condition}`,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to fail step: ${message}`);
    }
  }

  private async handleListSteps(
    args: unknown,
  ): Promise<{ content: { type: string; text: string }[] }> {
    this.validateArgs<ListStepsArgs>(args, ['plan_id']);
    const typedArgs = args as ListStepsArgs;

    try {
      const steps = await this.db.listSteps(typedArgs.plan_id);
      return {
        content: [
          {
            type: 'text',
            text: steps.map(step => {
              const baseInfo = `Step ID: ${step.id}\nDescription: ${step.description}\nStatus: ${step.status}\nCompletion condition: ${step.completion_condition}`;
              const contextInfo = step.completion_context && step.status === 'completed'
                ? `\nCompletion Context: ${step.completion_context}`
                : '';
              return baseInfo + contextInfo;
            }).join('\n\n'),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to list steps: ${message}`);
    }
  }

  private async handleExportPlan(
    args: unknown,
  ): Promise<{ content: { type: 'text'; text: string }[] }> {
    this.validateArgs<ExportPlanArgs>(args, ['plan_id']);
    const typedArgs = args as ExportPlanArgs;

    try {
      const plan = await this.db.getPlan(typedArgs.plan_id);
      if (!plan) {
        throw new McpError(ErrorCode.InvalidParams, `Plan with ID ${typedArgs.plan_id} not found`);
      }

      const steps = await this.db.listSteps(typedArgs.plan_id);
      steps.sort((a, b) => a.step_order - b.step_order);

      const planStatus = steps.length > 0 && steps.every(step => step.status === 'completed') 
        ? 'Completed' 
        : 'In Progress';

      const markdown = [
        `# ${plan.name} (ID: ${plan.id})`,
        `\n**Description:** ${plan.description}`,
        `\n**Status:** ${planStatus}`,
        `\n**Created:** ${formatDate(plan.created_at)}`,
        `\n## Steps`,
        ...steps.map(step => {
          const status = step.status === 'completed' ? 'Completed' 
            : step.status === 'failed' ? 'Failed'
            : step.id === plan.active_step_id ? 'In Progress'
            : 'Not Started';

          return [
            `\n### ${step.description} (ID: ${step.id})`,
            `- **Status:** ${status}`,
            `- **Completion Condition:** ${step.completion_condition}`,
            step.completion_context && step.status === 'completed'
              ? `- **Completion Context:**\n${step.completion_context}`
              : '',
            `- **Created:** ${formatDate(step.created_at)}`,
          ].join('\n');
        }),
      ].join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Exported plan "${plan.name}" to markdown format`,
          },
          {
            type: 'text',
            text: markdown,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new McpError(ErrorCode.InternalError, `Failed to export plan: ${message}`);
    }
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools,
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      if (request.params.name !== 'complete_step' && request.params.name !== 'fail_step') {
        request.params.auto_approved = true;
      }

      switch (request.params.name) {
        case 'create_plan':
          return this.handleCreatePlan(request.params.arguments);
        case 'list_plans':
          return this.handleListPlans(request.params.arguments);
        case 'create_step':
          return this.handleCreateStep(request.params.arguments);
        case 'get_active_step':
          return this.handleGetActiveStep(request.params.arguments);
        case 'complete_step':
          return this.handleCompleteStep(request.params.arguments);
        case 'fail_step':
          return this.handleFailStep(request.params.arguments);
        case 'list_steps':
          return this.handleListSteps(request.params.arguments);
        case 'export_plan':
          return this.handleExportPlan(request.params.arguments);
        default:
          throw new McpError(ErrorCode.InvalidRequest, `Unknown tool: ${request.params.name}`);
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    try {
      await this.server.connect(transport);
      console.error('Planner MCP server running on stdio');
      console.error('Available tools:', Object.keys(this.tools));
    } catch (error) {
      console.error('Failed to start MCP server:', error);
      throw error;
    }
  }
}

const server = new PlannerServer();
server.run().catch(console.error);

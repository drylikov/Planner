import sqlite3 from 'sqlite3';
const { Database } = sqlite3;
import { generateReadableId } from './utils.js';

type AnyObject = Record<string, unknown>;

// Add type for the Database class
type SqliteDatabase = typeof Database;
type SqliteError = Error & { code?: string };

export interface Plan extends AnyObject {
  id: string;
  name: string;
  description: string;
  created_at: string; 
  completion_context: string | null;
  active_step_id: string | null;
}

export interface Step extends AnyObject {
  id: string;
  plan_id: string;
  description: string;
  completion_condition: string;
  status: 'in_progress' | 'completed' | 'failed';
  step_order: number;
  created_at: string;
  completion_context: string | null;
}

interface StepCountRow {
  count: number;
}

interface PlanRow extends AnyObject {
  id: string;
  name: string;
  description: string;
  created_at: string;
  active_step_id: string | null;
}

interface StepRow extends AnyObject {
  id: string;
  plan_id: string;
  description: string;
  completion_condition: string;
  status: 'in_progress' | 'completed' | 'failed';
  completion_context: string | null;
  step_order: number;
  created_at: string;
}

function isPlan(obj: AnyObject): obj is Plan {
  return (
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.created_at === 'string' &&
    (obj.active_step_id === null || typeof obj.active_step_id === 'string')
  );
}

function isStep(obj: AnyObject): obj is Step {
  return (
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.plan_id === 'string' &&
    typeof obj.description === 'string' &&
    typeof obj.completion_condition === 'string' &&
    ['in_progress', 'completed', 'failed'].includes(obj.status as string) &&
    typeof obj.step_order === 'number' &&
    typeof obj.created_at === 'string' &&
    (obj.completion_context === null || typeof obj.completion_context === 'string')
  );
}

export class PlannerDatabase {
  private db: InstanceType<SqliteDatabase>;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    this.db.serialize(() => {
      // Create tables if they don't exist
      this.db.run(`
        CREATE TABLE IF NOT EXISTS plans (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          active_step_id TEXT
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS steps (
          id TEXT PRIMARY KEY,
          plan_id TEXT NOT NULL,
          description TEXT NOT NULL,
          completion_condition TEXT NOT NULL,
          status TEXT CHECK(status IN ('in_progress', 'completed', 'failed')) DEFAULT 'in_progress',
          step_order INTEGER NOT NULL,
          completion_context TEXT,
          created_at DATETIME DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
          FOREIGN KEY(plan_id) REFERENCES plans(id)
        )
      `);
    });
  }

  private async beginTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('BEGIN TRANSACTION', (err: SqliteError | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async commitTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('COMMIT', (err: SqliteError | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async rollbackTransaction(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run('ROLLBACK', (err: SqliteError | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async insertStep(
    stepId: string,
    planId: string,
    description: string,
    completionCondition: string,
    completionContext: string | null = null
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'INSERT INTO steps (id, plan_id, description, completion_condition, step_order, completion_context) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(step_order), 0) + 1 FROM steps WHERE plan_id = ?), ?)',
        [stepId, planId, description, completionCondition, planId, completionContext],
        function (this: { changes: number }, err: SqliteError | null) {
          if (err) return reject(err);
          resolve(this.changes);
        },
      );
    });
  }

  private async setActiveStep(planId: string, stepId: string | null): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE plans SET active_step_id = ? WHERE id = ?',
        [stepId || null, planId],
        (err: SqliteError | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  private async getStepCount(planId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT COUNT(*) as count FROM steps WHERE plan_id = ?',
        [planId],
        (err: SqliteError | null, row: StepCountRow) => {
          if (err) return reject(err);
          if (!row || typeof row.count !== 'number') return reject(new Error('Invalid step count'));
          resolve(row.count);
        },
      );
    });
  }

  async createPlan(name: string, description: string): Promise<Plan> {
    return new Promise((resolve, reject) => {
      const id = generateReadableId();
      this.db.run(
        'INSERT INTO plans (id, name, description) VALUES (?, ?, ?)',
        [id, name, description],
        async (err: SqliteError | null) => {
          if (err) return reject(err);
          
          // Get the created plan to get the actual timestamp
          this.db.get(
            'SELECT * FROM plans WHERE id = ?',
            [id],
            (err: SqliteError | null, row: PlanRow | undefined) => {
              if (err) return reject(err);
              if (!row || !isPlan(row)) {
                return reject(new Error('Failed to retrieve created plan'));
              }
              resolve(row);
            }
          );
        },
      );
    });
  }

  async getPlan(planId: string): Promise<Plan | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM plans WHERE id = ?',
        [planId],
        (err: SqliteError | null, row: PlanRow | undefined) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          if (!isPlan(row)) {
            return reject(new Error('Invalid plan data from database'));
          }
          resolve(row);
        },
      );
    });
  }

  async listPlans(page: number = 1, pageSize: number = 10): Promise<{ plans: Plan[]; total: number }> {
    return new Promise((resolve, reject) => {
      const offset = (page - 1) * pageSize;
      this.db.get(
        'SELECT COUNT(*) as count FROM plans',
        [],
        (err: SqliteError | null, countRow: { count: number }) => {
          if (err) return reject(err);
          const total = countRow.count;

          this.db.all(
            'SELECT * FROM plans ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [pageSize, offset],
            (err: SqliteError | null, rows: PlanRow[]) => {
              if (err) return reject(err);
              if (!Array.isArray(rows)) {
                return reject(new Error('Invalid plan list from database'));
              }
              const validPlans = rows.filter(isPlan);
              resolve({ plans: validPlans, total });
            },
          );
        },
      );
    });
  }

  async createStep(
    planId: string,
    description: string,
    completionCondition: string,
    completionContext: string | null = null
  ): Promise<Step> {
    const stepId = generateReadableId();

    try {
      await this.beginTransaction();

      await this.insertStep(stepId, planId, description, completionCondition, completionContext);

      const stepCount = await this.getStepCount(planId);

      if (stepCount === 1) {
        await this.setActiveStep(planId, stepId);
      }

      // Get the created step to get the actual timestamp
      const step = await new Promise<Step>((resolve, reject) => {
        this.db.get(
          'SELECT * FROM steps WHERE id = ?',
          [stepId],
          (err: SqliteError | null, row: StepRow | undefined) => {
            if (err) return reject(err);
            if (!row || !isStep(row)) {
              return reject(new Error('Failed to retrieve created step'));
            }
            resolve(row);
          }
        );
      });

      await this.commitTransaction();
      return step;
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  async getActiveStep(planId: string): Promise<Step | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT * FROM steps WHERE plan_id = ? AND status = "in_progress" ORDER BY step_order ASC LIMIT 1',
        [planId],
        (err: SqliteError | null, row: StepRow | undefined) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          if (!isStep(row)) {
            return reject(new Error('Invalid step data from database'));
          }
          resolve(row);
        },
      );
    });
  }

  private async getPlanForStep(stepId: string): Promise<string> {
    return new Promise((resolve, reject) => {
      this.db.get(
        'SELECT plan_id FROM steps WHERE id = ?',
        [stepId],
        (err: SqliteError | null, row: { plan_id: string } | undefined) => {
          if (err) return reject(err);
          if (!row || typeof row.plan_id !== 'string') {
            return reject(new Error('Invalid plan ID for step'));
          }
          resolve(row.plan_id);
        },
      );
    });
  }

  private async getNextStep(planId: string, currentStepId: string): Promise<Step | null> {
    return new Promise((resolve, reject) => {
      this.db.get(
        `SELECT * FROM steps 
         WHERE plan_id = ? 
         AND status = 'in_progress' 
         AND step_order > (SELECT step_order FROM steps WHERE id = ?)
         ORDER BY step_order ASC LIMIT 1`,
        [planId, currentStepId],
        (err: SqliteError | null, row: StepRow | undefined) => {
          if (err) return reject(err);
          if (!row) return resolve(null);
          if (!isStep(row)) {
            return reject(new Error('Invalid step data from database'));
          }
          resolve(row);
        },
      );
    });
  }

  private async markStepCompleted(stepId: string, completionContext: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(
        'UPDATE steps SET status = "completed", completion_context = ? WHERE id = ?',
        [completionContext, stepId],
        (err: SqliteError | null) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  async completeStep(stepId: string, completionContext: string): Promise<Step | null> {
    try {
      await this.beginTransaction();

      await this.markStepCompleted(stepId, completionContext);

      const planId = await this.getPlanForStep(stepId);
      const nextStep = await this.getNextStep(planId, stepId);

      await this.setActiveStep(planId, nextStep?.id || null);

      await this.commitTransaction();
      return nextStep;
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  async failStep(
    stepId: string,
    newStepDescription: string,
    newStepCompletionCondition: string,
  ): Promise<{ failed_step_id: string; new_step: Step }> {
    try {
      await this.beginTransaction();

      // Get the step and verify it exists
      const failedStep = await new Promise<StepRow>((resolve, reject) => {
        this.db.get(
          'SELECT steps.*, plans.active_step_id FROM steps JOIN plans ON steps.plan_id = plans.id WHERE steps.id = ?',
          [stepId],
          (err: SqliteError | null, row: (StepRow & { active_step_id: string | null }) | undefined) => {
            if (err) return reject(err);
            if (!row) {
              return reject(new Error('Step not found'));
            }
            if (!isStep(row)) {
              return reject(new Error('Invalid step data from database'));
            }
            if (row.active_step_id !== stepId) {
              return reject(new Error('Can only fail the current active step'));
            }
            if (row.status !== 'in_progress') {
              return reject(new Error('Can only fail steps that are in progress'));
            }
            resolve(row);
          },
        );
      });

      // Mark the step as failed
      await new Promise<void>((resolve, reject) => {
        this.db.run(
          'UPDATE steps SET status = "failed" WHERE id = ?',
          [stepId],
          (err: SqliteError | null) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      // Increment the step_order of all subsequent steps
      await new Promise<void>((resolve, reject) => {
        this.db.run(
          'UPDATE steps SET step_order = step_order + 1 WHERE plan_id = ? AND step_order > ?',
          [failedStep.plan_id, failedStep.step_order],
          (err: SqliteError | null) => {
            if (err) reject(err);
            else resolve();
          },
        );
      });

      // Create the new step with order = failed_step_order + 1
      const newStepId = generateReadableId();
      await this.insertStep(
        newStepId,
        failedStep.plan_id,
        newStepDescription,
        newStepCompletionCondition,
        null
      );

      // Set the new step as active
      await this.setActiveStep(failedStep.plan_id, newStepId);

      // Get the created step to get the actual timestamp
      const newStep = await new Promise<Step>((resolve, reject) => {
        this.db.get(
          'SELECT * FROM steps WHERE id = ?',
          [newStepId],
          (err: SqliteError | null, row: StepRow | undefined) => {
            if (err) return reject(err);
            if (!row || !isStep(row)) {
              return reject(new Error('Failed to retrieve created step'));
            }
            resolve(row);
          }
        );
      });

      await this.commitTransaction();

      return {
        failed_step_id: stepId,
        new_step: newStep,
      };
    } catch (error) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  async listSteps(planId: string): Promise<Step[]> {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM steps WHERE plan_id = ? ORDER BY step_order ASC',
        [planId],
        (err: SqliteError | null, rows: StepRow[]) => {
          if (err) return reject(err);
          if (!Array.isArray(rows)) {
            return reject(new Error('Invalid step list from database'));
          }
          const validSteps = rows.filter(isStep);
          resolve(validSteps);
        },
      );
    });
  }
}

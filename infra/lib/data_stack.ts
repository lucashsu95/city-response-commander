/**
 * Data Stack (shell) — placeholder for the demo backend task.
 * Full stack wiring is not in scope for this task.
 */

import { Stack } from 'aws-cdk-lib';
import type { EnvironmentContext } from './env_context.js';
import { Construct } from 'constructs';

export interface DataStackProps {
  envContext: EnvironmentContext;
  stackName?: string;
}

export class DataStack extends Stack {
  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, { stackName: props.stackName });
    // Shell — placeholder for production stack wiring
  }
}

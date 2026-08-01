/**
 * Frontend Stack (shell) — placeholder for the demo backend task.
 * Full stack wiring is not in scope for this task.
 */

import { Stack } from 'aws-cdk-lib';
import type { EnvironmentContext } from './env_context.js';
import { Construct } from 'constructs';

export interface FrontendStackProps {
  envContext: EnvironmentContext;
  stackName?: string;
}

export class FrontendStack extends Stack {
  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, { stackName: props.stackName });
    // Shell — placeholder for production stack wiring
  }
}

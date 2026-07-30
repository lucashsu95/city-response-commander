/**
 * Compute Stack (shell) — Lambda + Step Functions
 *
 * §24: ComputeStack (Lambda/Step Functions)
 * TASK-059: clean shell only, no AWS resources at this stage
 */

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { EnvironmentContext } from './env_context.js';

export interface ComputeStackProps extends StackProps {
  readonly envContext: EnvironmentContext;
}

export class ComputeStack extends Stack {
  public constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    // Shell — TASK-059: zero resources; infrastructure wiring complete
  }
}

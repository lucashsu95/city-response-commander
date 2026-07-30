/**
 * Network Auth Stack (shell) — Cognito + API Gateway
 *
 * §24: NetworkAuthStack (Cognito/API)
 * TASK-059: clean shell only, no AWS resources at this stage
 */

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { EnvironmentContext } from './env_context.js';

export interface NetworkAuthStackProps extends StackProps {
  readonly envContext: EnvironmentContext;
}

export class NetworkAuthStack extends Stack {
  public constructor(scope: Construct, id: string, props: NetworkAuthStackProps) {
    super(scope, id, props);

    // Shell — TASK-059: zero resources; infrastructure wiring complete
  }
}

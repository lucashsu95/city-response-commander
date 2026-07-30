/**
 * Data Stack (shell) — S3 + DynamoDB + Bedrock Knowledge Base
 *
 * §24: DataStack (S3/DynamoDB/KB)
 * TASK-059: clean shell only, no AWS resources at this stage
 */

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { EnvironmentContext } from './env_context.js';

export interface DataStackProps extends StackProps {
  readonly envContext: EnvironmentContext;
}

export class DataStack extends Stack {
  public constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // Shell — TASK-059: zero resources; infrastructure wiring complete
  }
}

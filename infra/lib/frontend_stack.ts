/**
 * Frontend Stack (shell) — Amplify / S3 + CloudFront
 *
 * §24: FrontendStack (Amplify or S3+CloudFront)
 * TASK-059: clean shell only, no AWS resources at this stage
 */

import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import type { EnvironmentContext } from './env_context.js';

export interface FrontendStackProps extends StackProps {
  readonly envContext: EnvironmentContext;
}

export class FrontendStack extends Stack {
  public constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    // Shell — TASK-059: zero resources; infrastructure wiring complete
  }
}

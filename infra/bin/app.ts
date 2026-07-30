/**
 * CDK App Root — instantiates four stacks with typed EnvironmentContext
 *
 * §24, §4.13, TASK-059
 * Run: cdk synth --context env=<PROFILE>
 * Profiles: LOCAL_MOCK | PERSONAL_AWS_DEV | COMPETITION_AWS
 */

import { App } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { NetworkAuthStack } from '../lib/network_auth_stack.js';
import { DataStack } from '../lib/data_stack.js';
import { ComputeStack } from '../lib/compute_stack.js';
import { FrontendStack } from '../lib/frontend_stack.js';

const app = new App();

// Resolve typed environment context from CDK context
const envContext = resolveEnvironmentContext(app.node);

// Stack IDs and names are prefixed with the resource prefix for uniqueness
const { resourcePrefix } = envContext;

new NetworkAuthStack(app, `${resourcePrefix}-network-auth`, {
  envContext,
  stackName: `${resourcePrefix}-network-auth`,
});

new DataStack(app, `${resourcePrefix}-data`, {
  envContext,
  stackName: `${resourcePrefix}-data`,
});

new ComputeStack(app, `${resourcePrefix}-compute`, {
  envContext,
  stackName: `${resourcePrefix}-compute`,
});

new FrontendStack(app, `${resourcePrefix}-frontend`, {
  envContext,
  stackName: `${resourcePrefix}-frontend`,
});

app.synth();

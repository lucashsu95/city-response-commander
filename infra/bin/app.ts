/**
 * Demo Backend CDK app entry point.
 *
 * The competition demo backend lives in a single stack:
 *   - CityCommanderDemoBackend
 *
 * It wires the demo API Lambda + production What-if Lambda + HTTP API
 * Gateway + private S3 data bucket. Authentication is intentionally
 * disabled for the competition demo (see `DemoBackendStack`).
 *
 * The CDK context contract:
 *   - `env=COMPETITION_AWS` selects the competition environment.
 *   - `demoBackend=true` opts this entry into the demo backend stack.
 *
 * @module infra/bin/app
 */
import { App } from 'aws-cdk-lib';
import { DemoBackendStack } from '../lib/demo_backend_stack.js';

const app = new App();

new DemoBackendStack(app, 'CityCommanderDemoBackend', {
  stackName: 'CityCommanderDemoBackend',
});

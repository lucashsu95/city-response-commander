/**
 * Demo Backend + Frontend CDK app entry point.
 *
 * Two independent stacks are deployed by this app:
 *   - CityCommanderDemoBackend: the competition demo backend (API + data bucket)
 *   - CityCommanderFrontend:    S3 + CloudFront hosting for the integrated demo
 *                              React/Vite SPA, sourced from
 *                              `packages/frontend/dist`.
 *
 * The two stacks do not share runtime resources and the frontend stack does
 * not depend on the backend stack. The frontend workflow resolves the backend
 * API URL at deploy time by reading the `DemoApiUrl` output from
 * `CityCommanderDemoBackend` directly via the AWS CLI, so the runtime
 * contract is purely the demo API URL string injected into the Vite build.
 *
 * The CDK context contract:
 *   - `env=COMPETITION_AWS` selects the competition environment.
 *   - `demoBackend=true` opts this entry into the demo backend stack.
 *   - `frontend=true` opts this entry into the frontend hosting stack.
 *
 * @module infra/bin/app
 */
import { App } from 'aws-cdk-lib';
import { DemoBackendStack } from '../lib/demo_backend_stack.js';
import { FrontendHostingStack } from '../lib/frontend_hosting_stack.js';

const app = new App();

new DemoBackendStack(app, 'CityCommanderDemoBackend', {
  stackName: 'CityCommanderDemoBackend',
});

new FrontendHostingStack(app, 'CityCommanderFrontend', {
  stackName: 'CityCommanderFrontend',
});

/**
 * Demo Backend Stack — minimal CDK stack for AWS demo backend
 *
 * Resources:
 * - Private S3 bucket (DemoDataBucket) with the 5 official files
 * - Demo Lambda (DemoApiFn) for /test, /health, /demo/* (incl. deprecated 410 for /demo/what-if)
 * - What-if Lambda (WhatIfFn) for the production POST /what-if pipeline
 * - HTTP API Gateway with CORS-enabled routes
 * - CloudFormation outputs
 *
 * @module infra/lib/demo_backend_stack
 */

import { Role, ServicePrincipal, PolicyDocument, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { HttpApi, HttpMethod, CorsHttpMethod } from '@aws-cdk/aws-apigatewayv2-alpha';
import { HttpLambdaIntegration } from '@aws-cdk/aws-apigatewayv2-integrations-alpha';
import { Stack, CfnOutput, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { Bucket, BucketEncryption } from 'aws-cdk-lib/aws-s3';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

export interface DemoBackendStackProps {
  readonly stackName?: string;
}

export class DemoBackendStack extends Stack {
  public readonly apiUrl: string;

  constructor(scope: Construct, id: string, props: DemoBackendStackProps = {}) {
    super(scope, id, {
      stackName: props.stackName ?? 'CityCommanderDemoBackend',
    });

    // ── Demo Data Bucket ────────────────────────────────────────────────────
    const dataBucket = new Bucket(this, 'DemoDataBucket', {
      bucketName: `city-commander-demo-data-${this.account}-${this.region}`,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: { blockPublicAcls: true, blockPublicPolicy: true, ignorePublicAcls: true, restrictPublicBuckets: true },
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // ── Bundle both Lambda code trees with esbuild ──────────────────────────
    const demoAssetDir = bundleLambdaAsset({
      entryCandidates: [
        path.resolve(__dirname, '../../../packages/backend/src/demo/lambda_handler.ts'),
        path.resolve(__dirname, '../../packages/backend/src/demo/lambda_handler.ts'),
        path.resolve(__dirname, '../packages/backend/src/demo/lambda_handler.ts'),
      ],
      outFile: 'lambda_handler.js',
      label: 'demo',
    });

    const whatifAssetDir = bundleLambdaAsset({
      entryCandidates: [
        path.resolve(__dirname, '../../../packages/backend/src/whatif/whatif_lambda.ts'),
        path.resolve(__dirname, '../../packages/backend/src/whatif/whatif_lambda.ts'),
        path.resolve(__dirname, '../packages/backend/src/whatif/whatif_lambda.ts'),
      ],
      outFile: 'whatif_lambda.js',
      label: 'whatif',
    });

    // ── Demo API Lambda IAM Role ───────────────────────────────────────────
    const demoRole = new Role(this, 'DemoApiFnRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        DemoApiFnPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: ['arn:aws:logs:*:*:*'],
            }),
          ],
        }),
      },
    });

    // ── Demo API Lambda Function ────────────────────────────────────────────
    const demoFn = new Function(this, 'DemoApiFn', {
      code: Code.fromAsset(demoAssetDir),
      handler: 'lambda_handler.handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(30),
      memorySize: 1024,
      role: demoRole,
      environment: {
        DEMO_DATA_BUCKET: dataBucket.bucketName,
        BEDROCK_REGION: 'us-west-2',
        DEMO_MODE: 'true',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
    });

    // ── What-if Lambda IAM Role ────────────────────────────────────────────
    // Mirrors the demo role + adds scoped bedrock:InvokeModel for the
    // competition production model. The role is intentionally narrow —
    // it cannot put / update / delete anything.
    const whatifRole = new Role(this, 'WhatIfFnRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        WhatIfFnPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['s3:GetObject', 's3:ListBucket'],
              resources: [dataBucket.bucketArn, `${dataBucket.bucketArn}/*`],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
              resources: ['arn:aws:logs:*:*:*'],
            }),
            new PolicyStatement({
              effect: Effect.ALLOW,
              actions: ['bedrock:InvokeModel'],
              resources: [
                `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-6`,
                'arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6',
              ],
            }),
          ],
        }),
      },
    });

    // ── What-if Lambda Function ────────────────────────────────────────────
    const whatifFn = new Function(this, 'WhatIfFn', {
      code: Code.fromAsset(whatifAssetDir),
      handler: 'whatif_lambda.handler',
      runtime: Runtime.NODEJS_20_X,
      timeout: Duration.seconds(60),
      memorySize: 1024,
      role: whatifRole,
      environment: {
        DEMO_DATA_BUCKET: dataBucket.bucketName,
        BEDROCK_REGION: 'us-west-2',
        BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
        // Explicitly opt the competition demo into public mode for
        // /what-if. This setting is only used by the demo Lambda; the
        // production stack does not set it.
        DEMO_PUBLIC_WHATIF: 'true',
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      },
    });

    // ── HTTP API Gateway ───────────────────────────────────────────────────
    const httpApi = new HttpApi(this, 'DemoHttpApi', {
      apiName: 'CityCommanderDemoApi',
      corsPreflight: {
        allowOrigins: ['https://demo.d1uqtrp9qafkl6.amplifyapp.com', 'http://localhost:5173', 'http://127.0.0.1:5173'],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.OPTIONS],
        allowHeaders: ['content-type'],
        allowCredentials: false,
      },
    });

    // ── Lambda Integrations ────────────────────────────────────────────────
    const demoIntegration = new HttpLambdaIntegration('DemoApiIntegration', demoFn);
    const whatifIntegration = new HttpLambdaIntegration('WhatIfApiIntegration', whatifFn);

    httpApi.addRoutes({ path: '/test', methods: [HttpMethod.GET], integration: demoIntegration });
    httpApi.addRoutes({ path: '/health', methods: [HttpMethod.GET], integration: demoIntegration });
    httpApi.addRoutes({ path: '/demo/timeseries', methods: [HttpMethod.GET], integration: demoIntegration });
    httpApi.addRoutes({ path: '/demo/incidents', methods: [HttpMethod.POST], integration: demoIntegration });
    // /demo/what-if is kept for backward compatibility but now returns 410.
    httpApi.addRoutes({ path: '/demo/what-if', methods: [HttpMethod.POST], integration: demoIntegration });
    httpApi.addRoutes({ path: '/demo/alerts', methods: [HttpMethod.POST], integration: demoIntegration });

    // Production What-if pipeline (deterministic Rule Engine + Bedrock).
    httpApi.addRoutes({ path: '/what-if', methods: [HttpMethod.POST], integration: whatifIntegration });

    // ── Deploy official data files to S3 ──────────────────────────────────
    // NOTE: BucketDeployment is intentionally omitted to avoid CDK v2.114's
    // bundled awscli (Python 3.9 incompatibility). Data files will be uploaded
    // separately via the AWS CLI in a follow-up step.

    // ── CloudFormation Outputs ────────────────────────────────────────────
    this.apiUrl = httpApi.url!;

    new CfnOutput(this, 'DemoApiUrl', { value: this.apiUrl, description: 'Base URL for the Demo HTTP API', exportName: 'CityCommanderDemoApiUrl' });
    new CfnOutput(this, 'DemoTestPageUrl', { value: `${this.apiUrl}test`, description: 'Browser test page URL', exportName: 'CityCommanderDemoTestPageUrl' });
    new CfnOutput(this, 'DemoDataBucketOutput', { value: dataBucket.bucketName, description: 'S3 bucket containing demo data', exportName: 'CityCommanderDemoDataBucket' });
    new CfnOutput(this, 'DemoApiFnArn', { value: demoFn.functionArn, description: 'ARN of the Demo API Lambda function', exportName: 'CityCommanderDemoApiFnArn' });
    new CfnOutput(this, 'WhatIfFnArn', { value: whatifFn.functionArn, description: 'ARN of the production What-if Lambda function', exportName: 'CityCommanderWhatIfFnArn' });
    new CfnOutput(this, 'WhatIfApiUrl', { value: `${this.apiUrl}what-if`, description: 'POST /what-if production endpoint', exportName: 'CityCommanderWhatIfApiUrl' });
  }
}

// ─── Lambda bundling via esbuild ───────────────────────────────────────────

interface BundleOptions {
  readonly entryCandidates: readonly string[];
  readonly outFile: string;
  readonly label: string;
}

function bundleLambdaAsset(opts: BundleOptions): string {
  const rootDir = path.resolve(__dirname, '../..');
  let lambdaEntry: string | null = null;
  for (const c of opts.entryCandidates) {
    if (fs.existsSync(c)) { lambdaEntry = c; break; }
  }
  if (!lambdaEntry) {
    throw new Error(`[${opts.label}] Could not find entry in: ${opts.entryCandidates.join(', ')}`);
  }

  const outDir = path.resolve(rootDir, `infra/.tmp/lambda-bundle-${opts.label}`);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const esbuildPath = path.resolve(rootDir, 'node_modules/.bin/esbuild');
  if (!fs.existsSync(esbuildPath)) {
    throw new Error('esbuild not found. Run `npm install esbuild` at repo root.');
  }

  execSync(
    [
      `"${esbuildPath}"`,
      `"${lambdaEntry}"`,
      '--bundle',
      '--platform=node',
      '--target=node22',
      '--format=cjs',
      `--outfile="${path.join(outDir, opts.outFile)}"`,
      '--external:@aws-sdk/*',
      '--minify=false',
    ].join(' '),
    { cwd: rootDir, stdio: 'inherit' },
  );

  return outDir;
}
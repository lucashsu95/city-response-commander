/**
 * Frontend Hosting Stack — AWS-hosted demo frontend.
 *
 * Resources:
 * - Private S3 bucket (`city-commander-frontend-<account>-<region>`) holding
 *   `packages/frontend/dist`
 * - CloudFront Distribution backed by the bucket via Origin Access Control (OAC)
 *   so the bucket can remain private (no public read ACL, no public policy)
 * - SPA fallback: `403` / `404` → `/index.html` → HTTP 200, TTL 0
 *
 * Hard limits respected (per the integration plan):
 * - Bucket remains private (`BlockPublicAccess.BLOCK_ALL`, `enforceSSL=true`)
 * - No Amplify, no CloudFront Functions for routing
 * - `GET/HEAD` only at the CloudFront edge
 * - `ViewerProtocolPolicy.REDIRECT_TO_HTTPS`
 * - The CDK context contract is unchanged (`env=COMPETITION_AWS`)
 *
 * @module infra/lib/frontend_hosting_stack
 */
import { Stack, CfnOutput, Duration, RemovalPolicy, Tags } from 'aws-cdk-lib';
import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  S3OriginAccessControl,
  ViewerProtocolPolicy,
  CachePolicy,
  AllowedMethods,
  CachedMethods,
  PriceClass,
  SecurityPolicyProtocol,
  HttpVersion,
  AccessLevel,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { Construct } from 'constructs';

export interface FrontendHostingStackProps {
  readonly stackName?: string;
}

export class FrontendHostingStack extends Stack {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;

  constructor(scope: Construct, id: string, props: FrontendHostingStackProps = {}) {
    super(scope, id, {
      stackName: props.stackName ?? 'CityCommanderFrontend',
    });

    // ── Private S3 Bucket ──────────────────────────────────────────────────
    // Predictable name keeps the GitHub workflow IAM policy deterministic.
    // If the bucket already exists in this account the import-style behavior
    // is handled by CloudFormation's existing-resource adoption path on first
    // deploy; a duplicate Bucket *cannot* be created by this stack because
    // S3 bucket names are globally unique.
    const bucketName = `city-commander-frontend-${this.account}-${this.region}`;
    this.bucket = new Bucket(this, 'FrontendBucket', {
      bucketName,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

    // ── Origin Access Control ──────────────────────────────────────────────
    // SIGV4_ALWAYS is the default and the recommended setting for S3 origins
    // routed through OAC. The bucket policy attached by `S3BucketOrigin`
    // grants the distribution `s3:GetObject` only.
    const originAccessControl = new S3OriginAccessControl(this, 'FrontendOAC', {
      originAccessControlName: `city-commander-frontend-oac-${this.account}-${this.region}`,
    });

    // ── CloudFront Distribution ────────────────────────────────────────────
    this.distribution = new Distribution(this, 'FrontendDistribution', {
      comment: 'City Commander Frontend — Demo Mode',
      defaultRootObject: 'index.html',
      httpVersion: HttpVersion.HTTP2,
      // Pricing class pinned to PRICE_CLASS_100 (NA/EU) for the demo window.
      priceClass: PriceClass.PRICE_CLASS_100,
      enableIpv6: true,
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(this.bucket, {
          originAccessControl,
          originAccessLevels: [AccessLevel.READ],
        }),
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: CachedMethods.CACHE_GET_HEAD,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      // SPA fallback: any 403/404 from S3 (key not found because the path is
      // a client-side route) serves `index.html` so HashRouter can take over.
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
      ],
    });

    // ── Outputs ────────────────────────────────────────────────────────────
    new CfnOutput(this, 'FrontendBucketName', {
      value: this.bucket.bucketName,
      description: 'S3 bucket holding the demo frontend bundle',
      exportName: 'CityCommanderFrontendBucketName',
    });
    new CfnOutput(this, 'FrontendDistributionId', {
      value: this.distribution.distributionId,
      description: 'CloudFront distribution ID for the demo frontend',
      exportName: 'CityCommanderFrontendDistributionId',
    });
    new CfnOutput(this, 'FrontendDistributionDomain', {
      value: this.distribution.distributionDomainName,
      description: 'CloudFront distribution domain for the demo frontend',
      exportName: 'CityCommanderFrontendDistributionDomain',
    });
    new CfnOutput(this, 'FrontendUrl', {
      value: `https://${this.distribution.distributionDomainName}`,
      description: 'Public HTTPS URL of the demo frontend',
      exportName: 'CityCommanderFrontendUrl',
    });

    // ── Tags (per integration plan) ────────────────────────────────────────
    Tags.of(this).add('Project', 'CityResponseCommander');
    Tags.of(this).add('Environment', 'CompetitionDemo');
    Tags.of(this).add('Component', 'Frontend');
  }
}

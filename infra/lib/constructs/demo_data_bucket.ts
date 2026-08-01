/**
 * Demo Data Bucket — private S3 bucket for demo Lambda data
 *
 * @module infra/lib/constructs/demo_data_bucket
 */

import { Bucket, BucketEncryption, BlockPublicAccess } from 'aws-cdk-lib/aws-s3';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface DemoDataBucketProps {
  readonly bucketName?: string;
}

export class DemoDataBucket extends Construct {
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: DemoDataBucketProps = {}) {
    super(scope, id);

    this.bucket = new Bucket(this, 'DemoDataBucket', {
      bucketName: props.bucketName ?? 'demo-data-bucket-placeholder',
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });
  }
}

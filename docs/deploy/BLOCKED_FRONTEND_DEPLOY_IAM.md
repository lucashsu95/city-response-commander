# Frontend Deploy IAM — BLOCKED_FRONTEND_DEPLOY_IAM

The `CityCommanderFrontend` S3 + CloudFront stack has been created in AWS by
`cdk deploy`, but the GitHub OIDC role
`arn:aws:iam::873354961545:role/GitHubActionsCityCommanderDeployRole` does not
have the S3 / CloudFront / CloudFormation read permissions required to upload
the static assets and clear the CloudFront cache.

Until this policy is attached, the deploy workflow will fail at the
`Upload hashed assets` step with:

```
fatal error: An error occurred (AccessDenied) when calling the ListObjectsV2
operation: ... is not authorized to perform: s3:ListBucket on resource:
"arn:aws:s3:::city-commander-frontend-873354961545-us-west-2"
```

## Action required

Apply the inline policy in `frontend-iam-inline-policy.json` (same folder) to
the OIDC role. Minimal reproduction:

1. AWS Console → IAM → Roles → `GitHubActionsCityCommanderDeployRole`
2. Permissions → Add permissions → Create inline policy → JSON
3. Paste the contents of `frontend-iam-inline-policy.json`
4. Name: `city-commander-frontend-deploy`
5. Save

### Statement summary

| Action | Resource |
|--------|----------|
| `s3:ListBucket`, `s3:GetBucketLocation` | `arn:aws:s3:::city-commander-frontend-873354961545-us-west-2` |
| `s3:PutObject`, `s3:DeleteObject`, `s3:GetObject` | `arn:aws:s3:::city-commander-frontend-873354961545-us-west-2/*` |
| `cloudfront:CreateInvalidation`, `cloudfront:GetInvalidation`, `cloudfront:GetDistribution` | `arn:aws:cloudfront::873354961545:distribution/*` |
| `cloudformation:DescribeStacks`, `cloudformation:DescribeStackEvents`, `cloudformation:ListStackResources`, `cloudformation:GetTemplate` | `arn:aws:cloudformation:us-west-2:873354961545:stack/CityCommanderFrontend/*` |

## After applying

Re-run the failed workflow:

```bash
gh workflow run deploy-temp-frontend-aws.yml --ref temp/restore-cdk-deployment-source
```

cdk deploy will detect that the stack already exists and either no-op (if
nothing changed) or update it. The asset sync steps will then populate
`packages/frontend/dist` into the S3 bucket and CloudFront will serve the
React/Vite SPA at `https://d1uh6vh5ux6xaq.cloudfront.net`.

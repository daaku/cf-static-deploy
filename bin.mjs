import AWS from 'aws-sdk';
import { readFile } from 'fs/promises';
import { nanoid } from 'nanoid';
import { extname } from 'path';
import Walker from 'walker';
import { contentType } from 'mime-types';

async function uploadDist(s3, diskBase, bucket) {
  return new Promise((resolve, reject) => {
    const pending = [];
    Walker(diskBase)
      .on('file', (filename) => {
        pending.push(upload(s3, filename, diskBase, bucket));
      })
      .on('error', (err) => {
        reject(err);
      })
      .on('end', async () => {
        try {
          await Promise.all(pending);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
  });
}

async function upload(s3, filename, diskBase, bucket) {
  const key = filename.substr(diskBase.length + 1); // strip dist/
  const body = await readFile(filename);
  let cacheControl = 'public, immutable, max-age: 31557600';
  if (key === 'index.html') {
    cacheControl = 'public, max-age: 600';
  }
  await s3
    .putObject({
      Bucket: bucket,
      Key: key,
      Body: body,
      ACL: 'public-read',
      ContentType: contentType(extname(filename)) || 'application/octet-stream',
      CacheControl: cacheControl,
    })
    .promise();
  console.log(`>> ${key}`);
}

async function main() {
  if (!process.env.AWS_ACCESS_KEY_ID) {
    console.error('AWS env variables missing');
    process.exit(1);
  }
  const bucket = process.env.DEPLOY_BUCKET;
  if (!bucket) {
    console.error('DEPLOY_BUCKET env variable missing');
    process.exit(1);
  }
  const distributionID = process.env.DEPLOY_DISTRIBUTION_ID;
  if (!distributionID) {
    console.error('DEPLOY_DISTRIBUTION_ID env variable missing');
    process.exit(1);
  }
  const diskBase = process.env.DEPLOY_DIR || 'dist';

  const s3 = new AWS.S3();
  await uploadDist(s3, diskBase, bucket);

  const cf = new AWS.CloudFront();
  await cf
    .createInvalidation({
      DistributionId: distributionID,
      InvalidationBatch: {
        CallerReference: nanoid(),
        Paths: {
          Quantity: 2,
          Items: ['/', '/index.html'],
        },
      },
    })
    .promise();
  console.log('Successfully created invalidation for CloudFront edge.');
}

await main();

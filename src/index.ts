import * as core from '@actions/core';
import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { WalrusClient } from '@mysten/walrus';

import { certifyBlobs } from './blob/certifyBlobs';
import { groupFilesBySize } from './blob/groupFilesBySize';
import { sleep } from './blob/helper/writeBlobHelper';
import { registerBlobs } from './blob/registerBlobs';
import { writeBlobs } from './blob/writeBlobs';
import { createSite } from './site/createSite';
import { updateSite } from './site/updateSite';
import { accountState } from './utils/accountState';
import { failWithMessage } from './utils/failWithMessage';
import { getSigner } from './utils/getSigner';
import { getWalrusSystem } from './utils/getWalrusSystem';
import { loadConfig } from './utils/loadConfig';

const main = async (): Promise<void> => {
  // Load configuration
  const config = loadConfig();
  const signer = getSigner();

  // Initialize Sui and Walrus clients
  const suiClient = new SuiClient({ url: getFullnodeUrl(config.network) });
  const walrusClient = new WalrusClient({
    network: config.network,
    suiClient,
  });

  const { systemObjectId, blobPackageId, walCoinType } = await getWalrusSystem(
    config.network,
    suiClient,
    walrusClient,
  );

  // Display owner address
  core.info('\nStarting Publish Walrus Site...\n');
  const walBlance = await accountState(config.owner, config.network, suiClient, walCoinType);

  // STEP 1: Load files from the specified directory
  core.info(`\n📦 Grouping files by size...`);
  const groups = groupFilesBySize(config);

  if (groups.length === 0) {
    failWithMessage('🚫 No files found to upload.');
  }

  // STEP 2: Register Blob IDs
  core.info('\n📝 Registering Blobs...');
  const blobs = await registerBlobs({
    config,
    suiClient,
    walrusClient,
    walCoinType,
    groups,
    blobPackageId,
    systemObjectId,
    walBlance,
    signer,
  });

  // Wait for 5 seconds to allow for blob registration
  await sleep(5000);

  // STEP 3: Write Blobs to Walrus
  core.info('\n📤 Writing blobs to nodes...');
  const blobsWithNodes = await writeBlobs({
    retryLimit: config.write_retry_limit || 5,
    suiClient,
    walrusClient,
    blobs,
  });

  // STEP 4: Certify Blobs
  core.info('\n🛡️ Certifying Blobs...');
  await certifyBlobs({
    config,
    suiClient,
    walrusClient,
    blobs: blobsWithNodes,
    signer,
  });

  // STEP 5: Create Site with Resources
  if (config.object_id) {
    core.info('\n🛠️ Update Site with Resources...');
    await updateSite({
      config,
      suiClient,
      walrusClient,
      blobPackageId,
      blobs,
      systemObjectId,
      siteObjectId: config.object_id,
      signer,
    });
  } else {
    core.info('\n🛠️ Creating Site with Resources...');
    await createSite({
      config,
      suiClient,
      blobs: blobsWithNodes,
      signer,
    });
  }
};

main();

const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('glacier:uploader');
const ProgressBar = require('progress');

const GLACIER_MAX_PARTS = 10000;
const GLACIER_SINGLE_SIZE_LIMIT = 4 * 1024 * 1024 * 1024;  // 4GB
// @todo add single archive upload in case we fit in 4Gb limits
let glacier;

const uploader = {
  upload: (file, vaultName, region) => {
    glacier = new AWS.Glacier({ region });

    const filePath = path.resolve(file);
    const { size: archiveSize } = fs.statSync(filePath);
    const bar = new ProgressBar('Uploading [:bar] :file :percent :etas', { total: archiveSize, width: 30 });
    const { partSize } = uploader.calculatePartSize(archiveSize);
    const accountId = '-';

    const initParams = { partSize: partSize.toString(), vaultName, accountId };

    glacier.initiateMultipartUpload(initParams, (err, result) => {
      if (err) {
        console.log(err, err.stack);
        return false;
      }
      debug(result);
      const uploadId = result.uploadId;
      const partsChecksums = [];

      let totalRead = 0;
      let totalSend = 0;
      let fileNumber = 0;
      let body = true;

      const fileStream = fs.createReadStream(filePath)
        .on('readable', function onReadable() {
          while (body) {
            body = this.read(partSize);
            const { treeHash: checksum } = glacier.computeChecksums(body);
            const uploadPartParams = {
              range: `bytes ${totalRead}-${totalRead + (body.length - 1)}/*`,
              accountId,
              uploadId,
              body,
              checksum,
              vaultName,
            };
            partsChecksums.push(checksum);
            fileStream.pause();
            glacier.uploadMultipartPart(uploadPartParams, (uploadErr) => {
              if (uploadErr) { return console.log(uploadErr); }
              fileNumber += 1;
              bar.tick(uploadPartParams.body.length, {
                file: fileNumber,
              });
              totalSend += uploadPartParams.body.length;
              fileStream.resume();
              if (totalSend === archiveSize) {
                uploader.completeMultipartUpload(
                  accountId, uploadId, archiveSize, vaultName, partsChecksums,
                );
              }
              return true;
            });
            totalRead += body.length;
          }
        });

      return fileStream;
    });
  },

  completeMultipartUpload: (accountId, uploadId, archiveSize, vaultName, partsChecksums) => {
    debug('All parts checksums (length): %s', partsChecksums.length);
    const checksum = uploader.computeFinalChecksum(partsChecksums);
    const params = { accountId, uploadId, archiveSize: archiveSize.toString(), checksum, vaultName };
    glacier.completeMultipartUpload(params, (err, result) => {
      if (err) { console.log(err); }
      debug('Complete multipart upload: %O', result);
      console.log(result);
    });
  },

  calculatePartSize: (archiveSize) => {
    let partSize = 1024 * 1024;
    let n = 20; // let's start with 1Mb
    while (archiveSize / partSize > GLACIER_MAX_PARTS) {
      partSize = 2 ** (n += 1);
    }
    const parts = Math.ceil(archiveSize / partSize);

    debug('File size: %s', archiveSize);
    debug('Part size: %s', partSize);
    debug('Parts: %s', parts);
    return { partSize, parts };
  },

  computeFinalChecksum: (chunkSHA256Hashes) => {
    // Unoptimized version of java function, just leave it as-is
    let prevLvlHashes = chunkSHA256Hashes;
    while (prevLvlHashes.length > 1) {
      let len = Math.floor(prevLvlHashes.length / 2);
      if (prevLvlHashes.length % 2 !== 0) {
        len += 1;
      }

      const currLvlHashes = new Array(len);
      let j = 0;
      for (let i = 0; i < prevLvlHashes.length; i += 2, j += 1) {
        if (prevLvlHashes.length - i > 1) {
          const buf1 = Buffer.from(prevLvlHashes[i], 'hex');
          const buf2 = Buffer.from(prevLvlHashes[i + 1], 'hex');
          const { treeHash } = glacier.computeChecksums(
            Buffer.concat([buf1, buf2], buf1.length + buf2.length),
          );
          currLvlHashes[j] = treeHash;
        } else { // Take care of remaining odd chunk
          currLvlHashes[j] = prevLvlHashes[i];
        }
      }
      prevLvlHashes = currLvlHashes;
    }
    debug(prevLvlHashes);
    return prevLvlHashes[0];
  },
};

module.exports = uploader;

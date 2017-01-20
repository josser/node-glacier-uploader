const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('glacier:uploader');
const ProgressBar = require('progress');

const GLACIER_MAX_PARTS = 10000;
const GLACIER_SINGLE_SIZE_LIMIT = 4 * 1024 * 1024 * 1024;  // 4GB
// @todo add single archive upload in case we fit in 4Gb limits
let glacier;
const accountId = '-';

const uploader = {
  partsChecksums: [],
  totalRead: 0,
  totalSend: 0,
  fileNumber: 0,
  retries: 0,

  abortMultipartUpload: () => {
    const { uploadId, vaultName } = uploader;
    const params = { accountId, uploadId, vaultName };
    glacier.abortMultipartUpload(params, (abortErr) => {
      if (abortErr) {
        console.log(abortErr, abortErr.stack); // an error occurred
      } else {
        console.log('Succesfully canceled');   // successful response
        process.exit();
      }
    });
  },
  upload: (file, vaultName, region) => {
    glacier = new AWS.Glacier({ region });

    const filePath = path.resolve(file);
    const { size: archiveSize } = fs.statSync(filePath);
    const { partSize, parts } = uploader.calculatePartSize(archiveSize);
    const initParams = { partSize: partSize.toString(), vaultName, accountId };

    uploader.archiveSize = archiveSize;
    uploader.vaultName = vaultName;
    glacier.initiateMultipartUpload(initParams, (err, { uploadId }) => {
      if (err) {
        console.log(err, err.stack);
        return false;
      }
      debug('Init multipart upload, id: %s ', uploadId);

      uploader.bar = new ProgressBar(
        `Uploading [:bar] :part/${parts}, Retries: :retries :percent :etas`, { total: archiveSize, width: 30 });

      uploader.uploadId = uploadId;

      process.on('SIGINT', () => {
        console.log('Cancel upload process...');
        uploader.abortMultipartUpload();
      });

      let body = true;

      const fileStream = fs.createReadStream(filePath)
        .on('readable', function onReadable() {
          while (body = this.read(partSize)) {
            const { treeHash: checksum } = glacier.computeChecksums(body);
            const uploadPartParams = {
              range: `bytes ${uploader.totalRead}-${uploader.totalRead + (body.length - 1)}/*`,
              uploadId,
              body,
              checksum,
              vaultName,
            };
            uploader.partsChecksums.push(checksum);
            glacier.uploadMultipartPart(uploadPartParams, (uploadErr, uploadResult) => {
              if (uploadErr) {
                return console.log(uploadErr);
              }
              return uploader.uploadDone(uploadErr, uploadPartParams, uploadResult);
            });
            uploader.totalRead += body.length;
          }
        });

      return fileStream;
    });
  },

  uploadDone: (err, params, result) => {
    debug('Upload done: %O', result);
    if (err) {
      uploader.uploadRetry(err.retryDelay, params);
      return console.log(err);
    }
    const { archiveSize } = uploader;
    uploader.fileNumber += 1;
    uploader.bar.tick(params.body.length, {
      part: uploader.fileNumber,
      retries: uploader.retries,
    });
    uploader.totalSend += params.body.length;
    if (uploader.totalSend === archiveSize) {
      uploader.completeMultipartUpload();
    }
    return true;
  },

  uploadRetry: (delay, params) => { // todo: add retry
    uploader.retries += 1;
    setTimeout((delay + 1) * 1000, () => {
      glacier.uploadMultipartPart(params, (err, result) => {
        if (err) {
          console.log(err);
          return false;
        }
        uploader.uploadDone(null, params, result);
        return true;
      });
    });
  },

  completeMultipartUpload: () => {
    const { uploadId, archiveSize, vaultName, partsChecksums } = uploader;
    debug('All parts checksums (length): %s', partsChecksums.length);
    const checksum = uploader.computeFinalChecksum(partsChecksums);
    const params = { accountId, uploadId, archiveSize: archiveSize.toString(), checksum, vaultName };
    glacier.completeMultipartUpload(params, (err, result) => {
      if (err) { return console.log(err); }
      debug('Complete multipart upload: %O', result);
      return console.log(result);
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
          const { treeHash } = glacier.computeChecksums(Buffer.concat([buf1, buf2], buf1.length + buf2.length));
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

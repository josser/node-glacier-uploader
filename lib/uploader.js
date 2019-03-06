const AWS = require('aws-sdk');
const fs = require('fs');
const path = require('path');
const debug = require('debug')('glacier:uploader');
const ProgressBar = require('progress');
const queue = require('async.queue');

const GLACIER_MAX_PARTS = 10000;
const GLACIER_SINGLE_SIZE_LIMIT = 4 * 1024 * 1024 * 1024; // 4GB
// @todo add single archive upload in case we fit in 4Gb limits

let glacier;
const accountId = '-';

const uploader = {
  partsChecksums: [],
  totalRead: 0,
  totalSend: 0,
  fileNumber: 0,
  retries: 0,

  queueWorker: (params, cb) => {
    glacier.uploadMultipartPart(params, (err, result) => {
      if (err) {
        debug('Got error: %O', err);
      }
      uploader.requestCount -= 1;
      uploader.fileStream.resume();
      uploader.uploadDone(err, params, result, cb);
    });
  },

  abortMultipartUpload: () => {
    const { uploadId, vaultName } = uploader;
    const params = { accountId, uploadId, vaultName };
    glacier.abortMultipartUpload(params, (abortErr) => {
      if (abortErr) {
        console.log(abortErr, abortErr.stack); // an error occurred
      } else {
        console.log('Succesfully canceled'); // successful response
        process.exit();
      }
    });
  },
  upload: (file, vaultName, region, concurency) => {
    glacier = new AWS.Glacier({ region });

    const filePath = path.resolve(file);
    const { size: archiveSize } = fs.statSync(filePath);
    const { partSize, parts } = uploader.calculatePartSize(archiveSize);
    const initParams = { partSize: partSize.toString(), vaultName, accountId };

    uploader.archiveSize = archiveSize;
    uploader.vaultName = vaultName;
    uploader.queue = queue(uploader.queueWorker, concurency);

    glacier.initiateMultipartUpload(initParams, (err, { uploadId }) => {
      if (err) {
        console.log(err, err.stack);
        return false;
      }
      debug('Init multipart upload, id: %s ', uploadId);

      uploader.bar = new ProgressBar(
        `Uploading [:bar] :part/${parts}, Retries: :retries, threads: :threads :percent :etas`,
        { total: archiveSize, width: 30 },
      );

      uploader.uploadId = uploadId;

      process.on('SIGINT', () => {
        debug('Cancel upload process...');
        uploader.abortMultipartUpload();
      });
      uploader.requestCount = 0;
      uploader.fileStream = fs
        .createReadStream(filePath, { highWaterMark: partSize })
        .on('data', (body) => {
          const { treeHash: checksum } = glacier.computeChecksums(body);
          const uploadPartParams = {
            range: `bytes ${uploader.totalRead}-${uploader.totalRead
              + (body.length - 1)}/*`,
            uploadId,
            body,
            checksum,
            vaultName,
          };
          uploader.partsChecksums.push(checksum);

          uploader.requestCount += 1;
          if (
            uploader.requestCount > concurency
            && !uploader.fileStream.isPaused()
          ) {
            uploader.fileStream.pause();
          }

          uploader.queue.push(uploadPartParams);
          uploader.totalRead += body.length;
        });
      return true;
    });
  },

  uploadDone: (err, params, result, cb) => {
    if (err) {
      debug('Scheduling retry');
      uploader.uploadRetry(err.retryDelay, params, cb);
      return false;
    }
    debug('Upload done: %O', result);
    const { archiveSize } = uploader;
    uploader.fileNumber += 1;
    uploader.bar.tick(params.body.length, {
      part: uploader.fileNumber,
      retries: uploader.retries,
      threads: uploader.requestCount,
    });
    uploader.totalSend += params.body.length;
    if (uploader.totalSend === archiveSize) {
      uploader.completeMultipartUpload();
    }
    cb();
    return true;
  },

  uploadRetry: (delay, params, cb) => {
    const timeout = (delay + 1) * 1000;
    debug('Retry scheduled: %s, ms', timeout);
    uploader.retries += 1;
    setTimeout(() => {
      glacier.uploadMultipartPart(params, (err, result) => {
        if (err) {
          debug(err);
          return false;
        }
        uploader.uploadDone(err, params, result, cb);
        return true;
      });
    }, timeout);
  },

  completeMultipartUpload: () => {
    const {
      uploadId, archiveSize, vaultName, partsChecksums,
    } = uploader;
    debug('All parts checksums (length): %s', partsChecksums.length);
    const checksum = uploader.computeFinalChecksum(partsChecksums);
    const params = {
      accountId,
      uploadId,
      archiveSize: archiveSize.toString(),
      checksum,
      vaultName,
    };
    glacier.completeMultipartUpload(params, (err, result) => {
      if (err) {
        return debug(err);
      }
      debug('Complete multipart upload: %O', result);
      return console.log(result);
    });
  },

  calculatePartSize: (archiveSize) => {
    let partSize = 1024 * 1024;
    let n = 20; // let's start with 1Mb
    while (archiveSize / partSize > GLACIER_MAX_PARTS) {
      partSize = Math.pow(2, (n += 1)); // eslint-disable-line
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
        } else {
          // Take care of remaining odd chunk
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

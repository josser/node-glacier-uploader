#!/usr/bin/env node
const program = require('commander');
const uploader = require('../lib/uploader.js');

program
  .version('0.0.1');

program
  .command('upload <file>')
  .option('-v, --vault-name <vaultName>', 'Vault name')
  .option('-r --region <region>', 'Region', 'us-west-2')
  .description('Multipart file upload to glacier')
  .action((file, options) => {
    const { vaultName, region } = options;
    uploader.upload(file, vaultName, region);
  });

program.parse(process.argv);
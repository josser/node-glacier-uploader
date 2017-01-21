#!/usr/bin/env node
const program = require('commander');
const uploader = require('../lib/uploader.js');

program
  .version('0.0.1');

program
  .command('upload <file>')
  .option('-v, --vault-name <vaultName>', 'Vault name')
  .option('-r --region <region>', 'Region', 'us-west-2')
  .option('-c --concurency <concurency>', 'How much uploads concurently', '20')
  .description('Multipart file upload to glacier')
  .action((file, options) => {
    const { vaultName, region, concurency } = options;
    uploader.upload(file, vaultName, region, concurency);
  });

program.parse(process.argv);

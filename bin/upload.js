#!/usr/bin/env node
const program = require('commander');
const uploader = require('../lib/uploader.js');

program
  .version('0.6.0');

program
  .command('upload <file>')
  .option('-v, --vault-name <vaultName>', 'Vault name')
  .option('-r --region <region>', 'Region', 'us-west-2')
  .option('-c --concurency <concurency>', 'How much uploads concurently', '20')
  .option('-d, --detail <detail>', 'Detailed description of the file', '')
  .description('Multipart file upload to glacier')
  .action((file, options) => {
    const { vaultName, region, concurency, detail } = options;
    uploader.upload(file, vaultName, region, concurency, detail);
  });

program.parse(process.argv);

# node-glacier-uploader

[![bitHound Dependencies](https://www.bithound.io/github/josser/node-glacier-uploader/badges/dependencies.svg)](https://www.bithound.io/github/josser/node-glacier-uploader/master/dependencies/npm)
[![NPM Downloads](https://img.shields.io/npm/dt/node-glacier-uploader.svg)](http://npmjs.com/package/node-glacier-uploader)

Simple multipart uploader for AWS Glacier

# Requirements:
* NodeJS 6.x
* aws-cli toolset for configuring AWS KEY and SECRET

# Install
```
npm install -g node-glacier-uploader
```

You have to configure you aws-cli before use via:
```
$ aws configure
```

# Usage
```
$ glacier upload [options] <file>

Options:
    -h, --help                    output usage information
    -v, --vault-name <vaultName>  Glacier vault name
    -r --region <region>          AWS Region, default to us-west-2
    -c --concurency <concurency>  How much uploads concurently, default = 20

```
Example:
```
glacier upload -v backups -c 10 archive.tar.gz
```

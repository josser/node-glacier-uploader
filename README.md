# node-glacier-uploader

![npm](https://img.shields.io/npm/dw/node-glacier-uploader)

Simple multipart uploader for AWS Glacier

# Requirements:
* NodeJS 10.x
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
    -d, --detail <detail>         Detailed description of the file

```
Example:
```
glacier upload -v backups -c 10 archive.tar.gz
```

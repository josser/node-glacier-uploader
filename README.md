# node-glacier-uploader
Simple multipart uploader for AWS Glacier

```
Usage: glacier upload [options] <file>

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

# Requirements: 
* NodeJS 7.0 (for ** operator) 
* aws-cli toolset for configuring AWS KEY and SECRET 

# Note 
You have to configure you aws-cli before use via: 
```
$ aws configure 
```

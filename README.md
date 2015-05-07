# mft-upload
A simple REST utility for uploading files to a Managed File Transfer server or other file based integration servers, SaaS or PaaS cloud applications.

## Use Cases
The intital use case is exposing a REST interface to upload to a SOAP WebService supporting inline XML for Binary. The utility works with Oracle Managed File Transfer server but uses payload templates so easily extensible to other use cases.

Future use cases include the following:

* Upload to FTP/SFTP
* Upload to FTP/SFTP with SOAP Pass-By-Reference notification
* Upload to SOAP service using MTOM attachments 
* Upload to other REST based file API's


## Prerequisites

It is assumed you have knowledge and a working MFT server installed such as [Oracle MFT](http://bit.ly/oramft).
The SOAP interface communicates with an MFT SOA or SOAP Source that must be configured on the MFT server that implements the [MFT SOAP WSDL](https://docs.oracle.com/middleware/1213/mft/MFTUG/mftug_create_trnsfr.htm#MFTUG309). 

## Installation

npm install mft-upload --save

## Usage

### Command Line

node upload.js file=index.js [config=req.json]

### Config File
The config file describes the endpoint and authentication used by the [HTTP Request package](https://github.com/request/request). A sample req.json shown below using Basic authentication is provided in the [files folder](files/req.json). This package supports many authentication types.


```
{
    "url": "http://localhost:7901/mftapp/services/transfer/SOAP2File",
    "method": "POST",
    "headers": { "Content-Type": "text/xml; charset=utf-8" },
    "body": "",
    "auth": { "user": "USERNAME", "pass": "PASSWORD" }
}
```

If a config argument is not provided, upload.js looks for one at ~/.mft/uploadreq.json


### Function getRequestConfig 
#### Asyncronous function to process CLI arguments and get the config file

```
getRequestConfig(process.argv, function(err, retargs, cfgfile, cfgjson) {
  if (err) {
    console.log(err);
    process.exit(1);
  }
  args = retargs;
  filepath = args.file;
  reqOptions = cfgjson;
});
```

### Function fileUpload
#### Asyncronous function to generate SOAP request and send it to the request endpoint URL

```
fileUpload(filepath, reqOptions, function(er, respcode, jsonbody, stats) {
  if (er) {
    console.log(er);
    process.exit(1);
  } 
  console.log('Response code is: ' +respcode);
  console.log(stats.summary);
});

```

## Test

npm install chai

npm test

## Contributing

1. Fork it!
2. Create your feature branch: `git checkout -b my-new-feature`
3. Commit your changes: `git commit -am 'Add some feature'`
4. Push to the branch: `git push origin my-new-feature`
5. Submit a pull request :D

## History

Created: May 6, 2015

## Credits

Dave Berry A.K.A (bigfiles)

## License

ISC

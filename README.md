# mft-upload
A simple REST utility for uploading files to a Managed File Transfer server or other file based integration servers, SaaS or PaaS cloud applications.

## Use Cases
This packages exposes a REST interface to upload to MFT SOAP WebServices or arbitrary HTTP form applications. The utility works with Oracle Managed File Transfer server and uses payload templates so easily extensible to other use cases.

Implemented
* SOAP inline XML or Binary base64 encoded data
* Upload to SOAP service using SOAP attachments (SwA) 
* HTTP Formdata for upload to arbitray web apps
* Chaining of requests for upload and notify SOAP service use cases
* Custom payload templates using templatedir property

Future use cases include the following:
* Upload to HTTP servers using MTOM attachments 

## Prerequisites

It is assumed you have knowledge and a working MFT server installed such as [Oracle MFT](http://bit.ly/oramft).
The SOAP interface communicates with an MFT SOA or SOAP Source that must be configured on the MFT server that implements the [MFT SOAP WSDL](https://docs.oracle.com/middleware/1213/mft/MFTUG/mftug_create_trnsfr.htm#MFTUG309). 

## Installation

npm install mft-upload --save


## Usage

### Command Line

node upload.js file=index.js [config=req.json]

### Config Files
The config file describes a request type and maximum file size at the root level. It also embedds and reuses the request type endpoint and authentication used by the [HTTP Request package](https://github.com/request/request). A sample req.json shown below using Basic authentication is provided in the [files folder](files/req.json). The request package supports many authentication types beyond what is shown below.


```
{
  "type": "SOAP",
  "maxsize": 20214400,
  "request": {
    "url": "http://HOSTNAME:7901/mftapp/services/transfer/SOAP2File",
    "method": "POST",
    "headers": { "Content-Type": "text/xml; charset=utf-8" },
    "auth": { "user": "USERNAME", "pass": "PASSWORD" }
  }
}
```


Following type support SOAP with Attachments.

```
{
  "type": "WSA",
  "maxsize": 5242880026214400,
  "request": {
    "uri": "http://HOSTNAME.com:7901/mftapp/services/transfer/SOAP2File",
    "method": "POST",
    "headers": {
       "FileName": "",
       "Content-Type": "multipart/related;type=\"text/xml\""
    },
    "multipart": [
       {
         "Content-Type": "text/xml;charset=UTF-8",
         "auth": { "user": "USERNAME", "pass": "PASSWORD" }
       },
       {
         "Content-Type": "application/octet-stream"
       }
    ]
  }
}
```

Config "templatedir" allows user provided templates with filename of "<type>-PAYLOAD"

```
{
  "type": "SOAP",
  "templatedir": "mytemplates", // template file is at "mytemplates/SOAP-PAYLOAD"
  "request": {
    "url": "http://localhost:7901/mftapp/services/transfer/SOAP2File",
    "method": "POST",
    "headers": { "Content-Type": "text/xml; charset=utf-8" },
    "auth": { "user": "USERNAME", "pass": "PASSWORD" }

  }
}
```


Illustrates chaining of requests using "cfgarr config array element for upload followed by a SOAP notification call.

```
{
  "type": "SOAP",
  "cfgarr": [
        { "config": "wsa.json", "file": "package.json"}
  ],
  "request": {
    "url": "http://HOSTNAME:7901/mftapp/services/transfer/SOAP2File",
    "method": "POST",
    "headers": { "Content-Type": "text/xml; charset=utf-8" },
    "auth": { "user": "USERNAME", "pass": "PASSWORD" }
  }
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

### Function upload
#### Async function that encapsulates getRequest and fileUpload into a single method.
#### Works with the config cfgarr element to chain requests.

```
upload(process.argv, function(err, respcode, jcfg, stats) {
  if (err) {
    console.log('Upload Error: ' +err);
    process.exit(1);
  };
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


var upload= require('../mft-upload');

// BEGIN MAIN
var filebody
var filepath;
var jsoncfg;
var args;

// MAIN processing
// utilize the upload convenience function to invoke functions upload.getRequestConfig and upload.uploadFile
// support chained requests using config.cfgarr object to invoke multiple services
/* chaining example
  {
    "type": "SOAP",
    "cfgarr": [
          { "config": ".tmp/wsa.json", "file": ".tmp/soap2.json"},
          { "config": ".tmp/wsa.json", "file": ".tmp/soap.json"}
    ],
    "request": {
      "url": "http://HOSTNAME:7901/mftapp/services/transfer/SOAP2File",
      "method": "POST",
      "headers": { "Content-Type": "text/xml; charset=utf-8" },
      "body": "",
      "auth": { "user": "USERNAME", "pass": "PASSWORD" }
    }
  }

*/

upload.upload(process.argv, function(err, respcode, jcfg, stats) {
  if (err) {
    //console.log('Upload Error: ' +err);
    console.trace('Upload Error: ' +err);
    process.exit(1);
  };
});

// END MAIN

process.on('uncaughtException', function(err) {
  // print the uncaught error and exit;
  console.log('uncaughtException:' +err);
  console.trace();
  process.exit(1);
});





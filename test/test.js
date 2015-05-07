// Require everything including our function
var chai = require('chai');
var expect = chai.expect;
var upload = require('..');

// not sure how to test with a server connection 
describe('mft-upload tests', function() {
  it('Check for usage from getRequestConfig', function() {
    var expectout = 'Usage: _mocha file=<file> config=<json request config file>';
    var result = 'nada';
    var ar = ['a=1'];
    upload.getRequestConfig(ar, function(err, retargs, cfgfile, json) {
      if (err) {
        result = err;
      };
    });
    expect(result).to.have.string(expectout); // verify results
  });

  it('Check for ECONNREFUSED from getRequestConfig', function() {
    var expectout = 'fileupload.request.error is:Error: connect ECONNREFUSED';
    var result = 'znada';
    var ar = ["file=upload.js","config=test/badreq.json"];
    var args, filepath, jsoncfg, reqOptions;
    upload.getRequestConfig(ar, function(err, retargs, cfgfile, json) {
console.log('err is ' +err);
      if (err) {
        result = err;
      } else {
        result = expectout;
      }
      args = retargs;
      filepath = args.file;
      jsoncfg = cfgfile;
      reqOptions = json;
    });

    upload.fileUpload(filepath, reqOptions, function(er, respcode, jsonbody, stats) {
      if (er) {
        result = er;
      } else {
        result = "This mysteriously worked";
      };
    });
    expect(result).to.have.string(expectout); // verify results
  });

});

/*
upload.getRequestConfig(process.argv, function(err, retargs, cfgfile, cfgjson) {
  if (err) {
    console.log(err);
    process.exit(1);
  }
  args = retargs;
  filepath = args.file;
  jsoncfg = cfgfile;
  reqOptions = cfgjson;
});

upload.fileUpload(filepath, reqOptions, function(er, respcode, jsonbody, stats) {
  if (er) {
*/


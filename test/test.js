// Require everything including our function
var chai = require('chai');
var expect = chai.expect;
var path = require("path");
var upload = require('..');

// not sure how to test with a server connection 
describe('1 - mft-upload "getRequestConfig" method sync test', function() {

  it('Check for usage from getRequestConfig', function() {
    var exp = 'Usage: _mocha file=<file> config=<json request config file>';
    var res = '';
    var ar = ['a=1'];
    upload.getRequestConfig(ar, function(err, retargs, cfgfile, json) {
      if (err) {
        res = err;
      };
    });
    expect(res).to.have.string(exp); // verify results
  });
});

describe('2 - mft-upload "fileUpload" method async test', function() {
  var res = '';
  var exp = 'Error: connect ECONNREFUSED';
  var ar = [,];

  ar[0] = 'file=' +path.join(__dirname, 'test.js');
  ar[1] = 'config=' +path.join(__dirname, 'badreq.json');
  var args, filepath, jsoncfg, reqOptions;

  beforeEach(function(done){
    upload.getRequestConfig(ar, function(err, retargs, cfgfile, json) {
      if (err) {
        //console.log('TEST getRequestConfig err is ' +err);
        res = err;
      }
      args = retargs;
      filepath = args.file;
      jsoncfg = cfgfile;
      reqOptions = json;
    });

    upload.fileUpload(filepath, reqOptions, function(er, respcode, jsonbody, stats) {
      if (er) {
        //console.log('TEST fileUpload er is ' +er);
        res = '' +er;
      };
      done();
    });
  });

  it('Check for ECONNREFUSED from fileUpload ', function() {
    expect(res).to.have.string(exp); // verify results
  });
});

describe('3 - mft-upload "upload" method async test', function() {
  var res = '';
  var exp = 'Error: connect ECONNREFUSED';
  var ar = [,];
  ar[0] = 'file=' +path.join(__dirname, 'test.js');
  ar[1] = 'config=' +path.join(__dirname, 'badreq.json');
  var args, filepath, jsoncfg, reqOptions;

  beforeEach(function(done){
    upload.upload(ar, function(er, respcode, jcfg, stats) {
      if (er) {
        //console.log('TEST fileUpload er is ' +er);
        res = '' +er;
      };
      done();
    });
  });

  it('Check for ECONNREFUSED from upload ', function() {
    expect(res).to.have.string(exp); // verify results
  });

});

describe('4 - mft-upload "upload" method async connect invalid header test', function() {
  var res = '';
  var exp1 = 'ERROR: fileUpload.request Response code of 400 is not 200';
  var exp2 = 'Invalid Header Content Type';

  var ar = [,];
  ar[0] = 'file=' +path.join(__dirname, 'test.js');
  ar[1] = 'config=' +path.join(__dirname, 'badheader.json');
  var args, filepath, jsoncfg, reqOptions;

  var server = require(path.join(__dirname,'/lib/server.js'))

  before(function () {
    server.listen(8000);
  });

  after(function () {
    server.close();
  });

  beforeEach(function(done){
    upload.upload(ar, function(er, respcode, jcfg, stats) {
      if (er) {
        //console.log('TEST fileUpload er is ' +er);
        res = '' +er;
      };
      done();
    });
  });

  it('Check for 400 not 200 and invalid header ', function() {
    expect(res).to.have.string(exp1); // verify results
    expect(res).to.have.string(exp2); // verify results
  });

});

describe('5 - mft-upload "upload" method async successful upload test', function() {
  var res1 = '';
  var res2 = '';
  var exp1 = 200;
  var exp2 = 'Upload of file "test.js" of ';
  var ar = [,];
  ar[0] = 'file=' +path.join(__dirname, 'test.js');
  ar[1] = 'config=' +path.join(__dirname, 'upload.json');
  var args, filepath, jsoncfg, reqOptions;

  var server = require(path.join(__dirname,'/lib/server.js'))

  before(function () {
    server.listen(8000);
  });

  after(function () {
    server.close();
  });

  beforeEach(function(done){
    upload.upload(ar, function(er, respcode, jcfg, stats) {
      if (er) {
        res1 = respcode;
        if (!res1) res1 = '500';
        //console.log('TEST5 ERROR fileUpload er is ' +er);
        res2 = '' +er;
      } else {
        //console.log('TEST5 NO ERROR respcode: ' +respcode);
        //console.log('TEST5 stats:.summary ' +stats.summary);
        res1 = respcode;
        res2 = stats.summary;
      }
      done();
    });
  });

  it('Check for 200 and successful upload', function() {
    expect(res1).to.equal(exp1); // verify results
    expect(res2).to.have.string(exp2); // verify results
  });
});

describe('6 - mft-upload "upload" method async test invalid URL', function() {
  var res1 = '';
  var res2 = '';
  var exp1 = 500;
  var exp2 = 'Invalid Request URL';
  var ar = [,];
  ar[0] = 'file=' +path.join(__dirname, 'test.js');
  ar[1] = 'config=' +path.join(__dirname, 'badurl.json');
  var args, filepath, jsoncfg, reqOptions;

  var server = require(path.join(__dirname,'/lib/server.js'))

  before(function () {
    server.listen(8000);
  });

  after(function () {
    server.close();
  });

  beforeEach(function(done){
    upload.upload(ar, function(er, respcode, jcfg, stats) {
      //console.log('TEST fileUpload er is ' +er);
      res1 = respcode;
      res2 = er;
      done();
    });
  });

  it('Check for 500 and Invalid URL', function() {
    expect(res1).to.equal(exp1); // verify results
    expect(res2).to.have.string(exp2); // verify results
  });
});

describe('7 - mft-upload "upload" method UCM Bad Response async test', function() {
  var res1 = '';
  var exp1 = 'validateSOAPResponse parse error: Error: java.lang.reflect.InvocationTargetException';
  var ar = [,];
  ar[0] = 'file=' +path.join(__dirname, 'ucmbad.json');
  ar[1] = 'config=' +path.join(__dirname, 'ucmbad.json');

  var server = require(path.join(__dirname,'/lib/server.js'))

  before(function () {
    server.listen(8001);
  });

  after(function () {
    server.close();
  });

  beforeEach(function(done){
    upload.upload(ar, function(er, respcode, jcfg, stats) {
      //console.log('TEST7 BAD UCM er is ' +er);
      res1 = er;
      done();
    });
  });

  it('Check for validateSOAPResponse ERROR', function() {
    expect(res1).to.equal(exp1); // verify results
  });
});


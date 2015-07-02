var request = require('request');
var fs = require("fs");
var path = require("path");
var outils = require('omft-utils');
var util = require('util');
var osenv = require('osenv');

// BEGIN INTERNAL FUNCTIONS AND PROPERTIES

var _DEFAULT_MAX_FILE_SIZE = 26*1024*1024;
var _PASSWORDS = [];

function getStats(start, end,  fn, path, sz) {
  var ms = end-start
  //console.log('fn/sz/ms:' +fn +'/' +sz +'/' +ms);
  var rate = Number(sz/(ms)).toFixed(2);
  var size = Number(sz/1024).toFixed(2);
  var time = Number(ms/1000).toFixed(2);
  var s = 'Upload of file "' +fn +'" of '   +size +' kb took ' +time +' seconds at ' +rate +' KBs';
  return s;
};

// validate the HTTP/SOAP response looking for SOAP Faults. Mostly for MFT responses which uses 200 even for SOAP Faults
// throws an error if a fault is found
var validateSOAPResponse = function(soapbody, cb) {
  var xml2js = require('xml2js');
  var po = { mergeAttrs: 'true'}; 
  var myerr = '';
  var mj;

  var parser = new xml2js.Parser(po);
  parser.parseString(soapbody, function (err, json) {

    if (err) {
      var serr = '' +err;
      var allow = 'Error: Non-whitespace before first tag';
      if (serr.indexOf(allow) != 0) {
        var e2 = 'validateSOAPResponse parse error: ' +serr;
        return cb(e2);
      };
    } else {
      mj = json;
    };
  });

  if (!mj) return cb('');

  try {
    /* example of MFT env
      { 'xmlns:env': [ 'http://schemas.xmlsoap.org/soap/envelope/' ],
        'env:Header': [ '' ],
        'env:Body': [ { 'env:Fault': [Object] } ] }
      [ { 'env:Fault': [ [Object] ] } ]
    */

    //console.log(mj);
    var env = mj["env:Envelope"];
    if (!env) return cb('');
    var hdr = env["env:Header"];
    if (!hdr) return cb('');
    var bdy = env["env:Body"];
    if (!bdy) return cb('');
    //console.log(env);
    //console.log(bdy);
    /* example of fault
    [ { 'env:Fault': [ [Object] ] } ]
    [ { faultcode: [ 'env:MFT_WS_INBOUND_INVALID_SOAP_REQUEST' ],
        faultstring: [ 'MFT message processing failed with exception code: MFT_WS_INBOUND_INVALID_SOAP_REQUEST' ],
        faultactor: [ 'http://hostname.com:7901/mftapp/services/transfer/SOAP2File' ],
        detail: [ [Object] ] } ]
    */

    var flt = bdy[0]['env:Fault'];
    if (flt) {
      var fcode = flt[0].faultcode;
      var fstr  = flt[0].faultstring;
      var fact  = flt[0].faultactor;
      var ferr = 'faultcode:' +fcode +'; ';
      ferr += 'faultstring:' +fstr +'; ';
      ferr += 'faultactor:' +fact +'; ';
      myerr = 'validateSOAPResponse parse error: ' +ferr;
      //console.log(myerr);
      return cb(myerr);
    };

   var gr = bdy[0]["ns2:GenericResponse"];
   //console.log('validateSOAPResponse IS UCM GenericResponse');
   if (!gr) return cb('');
   var svc = gr[0]["ns2:Service"];
   //console.log('validateSOAPResponse Looks like UCM');
   //console.log('validateSOAPResponse IS UCM Service');
   if (!svc) return cb('');
   var doc = svc[0]["ns2:Document"];
   //console.log('validateSOAPResponse IS UCM Document');
   if (!doc) return cb('');
   var fld = doc[0]["ns2:Field"];
   //console.log('validateSOAPResponse IS UCM Field');
   //console.log('validateSOAPResponse FLD:' +util.inspect(fld, {depth:5}));
   if (!fld) return cb('');
   var fer = fld[0]["_"];
   //console.log('validateSOAPResponse IS UCM Error');
   if (!fer) return cb('');
   if (fer.toUpperCase().indexOf('ERROR:') > -1) {
     myerr = 'validateSOAPResponse parse error: ' +fer;
     //console.log('validateSOAPResponse WCC ERROR:' +myerr);
     //console.trace();
     return cb(myerr);
   };

  } catch (per) {
    console.log('VALIDATESOAPRESPONSE CATCH:' +per);
    return cb(per);
  };

  return cb(myerr);
};

// generate json from the SOAP body
// small convenience method using xml2js
var soap2json = function(soapbody, cb) {
  var xml2js = require('xml2js');
  var po = { mergeAttrs: 'true' }; 

  //console.log('SOAP2JSON BODY:' +soapbody);
  var parser = new xml2js.Parser(po);
  parser.parseString(soapbody, function (err, json) {
    if (err) {
      var e2 = 'soap2json error: ' +err;
      //console.log('SOAP2JSON ERROR:' +err + ' ' +soapbody);
      return cb(e2, json);
    };

    return cb(err, json);
  });
};

// recursive invocation simulating a for loop
function nextUpload(carr) {
  if (carr.length == 0) {
    // all uploads completed
    //console.log('nextUpload EXIT: carr length is 0');
    return;
  };

  var cfg   = carr.shift();
  var ccfg  = cfg.config;
  var cfile = cfg.file; 
  var str = 'B4 carr.length = ' +carr.length +' Config=' +ccfg +' File=' +cfile;
  var argv2 = ['file='+cfile, 'config='+ccfg];
  //console.log('nextUpload ENTRY:' +str);
  upload(argv2, function(er2, respcode2, jcfg2, stats2) {
    if (er2) {
      var estr = 'Request.cfgarr config=' +ccfg +' file=' +cfile +' ' +er2;
      console.log(estr);
      process.exit(1);
    } else {
      nextUpload(carr);
    };
  });
};

// update password in the request if it was provided in the cmd line options
// Supports:
//   SOAP HTTP Auth cfg.request.auth See https://github.com/request/request#http-authentication.
var updateReqPassword = function(cfg) {
    var ret = true;
    if (_PASSWORDS.length > 0) {
        //console.log('UPDATEREQPASSWORD _PASSWORDS.length: ' +_PASSWORDS.length);
        //console.log('UPDATEREQPASSWORD cfg: ' ,cfg);
        // user must be provided before we will update the password field
	if (cfg.request.auth && cfg.request.auth.user) { // 
	  mypass = _PASSWORDS.shift();
          cfg.request.auth.pass = mypass;
	  //console.log('UPDATEREQPASSWORD request HTTP password updated: ' +mypass); 
	} else
	  ret = false;
    };
    return ret;
};


// END INTERNAL ONLY FUNCTIONS

// BEGIN EXPORTED FUNCTIONS
// the majority of the work is done here uploading the file
var fileUpload = function(fn, cfg, cb) {
  // cb(er, respcode, body, stats)
  var stats = {};
  var fstats = {};
  var myer = '';
  var filebody, resp = '';
  var start, end; 
  var filepath = fn;
  var filename =  path.basename(filepath);
  var filesize = 0;
  var rc;
  var newpass;
  var maxsize = cfg.maxsize;
  var reqtype = cfg.type;
  var req = cfg.request;
  var cfgarr = cfg.cfgarr;

  cfg.file = filepath || cfg.filepath;
  maxsize ? maxsize : _DEFAULT_MAX_FILE_SIZE;

  // check if request is "chained"
  if (cfgarr && cfgarr.length > 0) {
    //console.log('cfgarr.length is ' +cfgarr.length);
    for (var i in cfgarr) {
      var mycfg = cfgarr[i];
      var ccfg  = mycfg.config;
      var cfile = mycfg.file;
      //console.log('cfgarr.length = ' +cfgarr.length +' Config=' +ccfg +' File=' +cfile);
      fs.stat(ccfg, function (er, fstats) {
       if (er)
        return cb('Request.cfgarr ' +i +' config does not exist: ' +ccfg) +' ' +er;
      });
      fs.stat(cfile, function (er, fstats) {
       if (er)
        return cb('Request.cfgarr ' +i +' file does not exist: ' +cfile) +' ' +er;
      });
    };
  };

  //console.log("Maxsize is: " +maxsize);
  // update passwords before doing temnplate/genUploadRequest if passwords arg provided
  newpass = updateReqPassword(cfg);

  switch (reqtype.toUpperCase()) {
        case 'FORM':
          var formname = cfg.formname;
	  console.log("formname is " +formname);
          req.formData[formname].value = fs.readFileSync(filepath, "utf8");
          break;
        case 'WSA':
          // generate the request
          outils.genUploadRequest(cfg, function(er, fsz, bdy) {
            if (er) {
              var err = 'fileUpload error: ' +er;
              return cb(err);
            }
            filesize = fsz;
            req.headers.FileName = filename;
            req.multipart[0].body = bdy;
            req.multipart[1].body = fs.createReadStream(filepath);
          }); 
          break;
        default: // SOAP, WSSE, UCM
          // special handling for WSEE to not require outils to do it
          if (cfg.request.auth.user) cfg.user=cfg.request.auth.user;
          if (cfg.request.auth.pass) cfg.pass=cfg.request.auth.pass;

          //console.log(JSON.stringify(cfg));
          // generate the request payloads
          outils.genUploadRequest(cfg, function(er, fsz, bdy) {
            if (er) {
              var err = 'fileUpload error: ' +er;
              return cb(err);
            }
            filesize = fsz;
            req.body = bdy;
          }); 
          break;
      }
  // invoke the request with timings
  start = new Date();
  end = new Date();

  //console.log('UPLOAD req: ' , req);

  request(req, function (error, response, body) {
    resp = response;
    if (error) {
	console.log('fileupload.request.error is:' +error);
	return cb(error, response);
    }
    rc = response.statusCode;
    //console.log('FileUpload Response code is:' +rc);
    end = new Date();
    if (rc == 200) {
        // Print out the response body
        //console.log(req.body);
        //console.log(body)


        // UCM hack to parse out soap body from the raw response returned by UCM
        // breaks if Soap Env case or prefix changes
        /*
          validateSOAPResponse SOAPBODY:------=_Part_969_463242553.1435268621680
          Content-Type: application/xop+xml;charset=utf-8;type="text/xml"
          Content-Transfer-Encoding: 8bit
          Content-ID: <d074d265-6028-48df-8ad2-f567825a4d28>
          <?xml version="1.0" encoding="utf-8" ?>
          <env:Envelope xmlns:env="http://schemas.xmlsoap.org/soap/envelope/"><env:Header/>
            <env:Body>
              <ns2:GenericResponse xmlns:ns2="http://www.oracle.com/UCM" webKey="cs">
                <ns2:Service IdcService="CHECKIN_NEW">
                  <ns2:Document>
                    <ns2:Field name="error">Error: java.lang.reflect.InvocationTargetException</ns2:Field>
                  </ns2:Document>
                </ns2:Service>
              </ns2:GenericResponse>
            </env:Body>
          </env:Envelope>
          ------=_Part_969_463242553.1435268621680--
        */
        var splitstr = 'env:Envelope';
        var bodyparts = body.split(splitstr);
        var newbody;
        if (bodyparts.length === 3) {
          var newbody = '<' +splitstr +bodyparts[1] +splitstr +'>';
          //console.log('REQUEST newbody:' +newbody);
          body = newbody;
        };
        // END UCM

        validateSOAPResponse(body, function(verr) {
          if (verr) {
	    //console.log(verr); 
	    myer = verr;
          };
        });
    } else {
      myer = 'ERROR: fileUpload.request Response code of ' +rc +' is not 200' +"\n";;
      myer += body;
      //console.log(myer);
      return cb(myer, rc);
    }
    // convert body to json for return
    soap2json(body, function(err, json) {
      if (!err && json) body = json;
    });
    stats.filename = filename;
    stats.filepath = filepath
    stats.filesize = filesize;
    stats.summary = getStats(start, end, filename, filepath, filesize);

    // all done, invoke the callback
    cb(myer, rc, body, stats);
  });
};

module.exports.fileUpload = fileUpload;

// getRequestConfig
// parse the arguments to find the file to upload
// find the request json config file

//function getRequestConfig(argv, cb) {
var getRequestConfig = function(argv, cb) {
  //
  //console.log('GETREQUESTCONFIG: argv is: ' +argv);
  // return cb(err, args, cfgfile, cfgjson)
  var reqOptions, jsoncfg;
  var args = outils.parseCalloutArgs(argv);

  if (!args.file) {
    var me = path.basename(process.argv[1]);
    var e1 = 'ERROR: File argument not provided' +"\n";
    var u = 'Usage: ' +me + ' file=<file> config=<json request config file>';
    var err = e1 +u;
    return cb(err);
  };

  var filepath = args.file;
  var passwords = args.passwords;
  if (passwords) {
    //console.log('GETREQUESTCONFIG passwords:' +passwords);
    if (_PASSWORDS.length === 0) {
	//console.log('GETREQUESTCONFIG Updating _PASSWORDS:' +passwords);
        var sp = passwords.split(' ');
	for (var i = 0; i < sp.length; i++) {
	  //console.log('GETREQUESTCONFIG _PASSWORDS:' +i, sp[i]);
	  _PASSWORDS[i] = sp[i];
	};
    };

  };

  if (args.config) {
    jsoncfg = args.config;
    if (!path.isAbsolute(jsoncfg)) {
      //console.log('path is ' +path.dirname(jsoncfg) +' ' + jsoncfg);
      jsoncfg = path.resolve(jsoncfg);
    }
  } else {
    var home = osenv.home();
    var jpath = path.parse(process.argv[1]);
    var jfname = jpath.name + '.json';
    jsoncfg = path.join(home, '/.mft/', jfname);
  };

  try {
    // remove comments from the cfg file
    var strip = require('strip-json-comments');
    var reqOptions = JSON.parse(strip(fs.readFileSync(jsoncfg, "utf8")));

    var cfgtype = reqOptions.type;
    //console.log(jsoncfg +' ' +JSON.stringify(reqOptions));
    if (!cfgtype) { 
      var cerr = 'getRequestConfig config invalid config file:' +jsoncfg;
      return cb(cerr);
    } else {
      return cb('', args, jsoncfg, reqOptions);
    };
  } catch (ee) {
    var merr = 'getRequestConfig config read/parse error ' +jsoncfg +' ' +ee;
    return cb(merr);
  }
};

module.exports.getRequestConfig = getRequestConfig;

// convenience function that does both config and upload
// might roll this into the upload API index.js
function upload(myargv, cb) {
  var jsoncfg, filepath, args;
  getRequestConfig(myargv, function(err, retargs, cfgfile, jcfg) {
    if (err) {
      //console.log(err);
      //console.trace(err);
      return cb(err);
    }
    args = retargs;
    filepath = args.file;

    jsoncfg = jcfg;

    fileUpload(filepath, jsoncfg, function(er, respcode, jsonbody, stats) {
      if (er) {
        var err = 'main.fileUpload error: ' +er;
        //console.log('UPLOAD ERROR: ' +er);
        //console.log('UPLOAD args: ', args);
        //console.trace('UPLOAD TRACE:', jsoncfg);
        return cb(er, respcode);
      } else {
        console.log('Response code is: ' +respcode);
        console.log(stats.summary);
        // support chaining of requests
        var cfgarr = jsoncfg.cfgarr;
        if (cfgarr && cfgarr.length > 0) {
          nextUpload(cfgarr);
        } else {
          return cb('', respcode, jsoncfg, stats);
        };
      };
    });
  });
};
module.exports.upload = upload;

// END EXPORTED FUNCTIONS

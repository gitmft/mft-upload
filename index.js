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

  //console.log('VALIDATESOPARESPONSE soapbody:', soapbody.substring(0,50));
  //console.log('VALIDATESOPARESPONSE soapbody:', soapbody);

  var parser = new xml2js.Parser(po);
  parser.parseString(soapbody, function (err, json) {

    if (err) {
      var serr = '' +err;
      var allow = 'Error: Non-whitespace before first tag';
      if (serr.indexOf(allow) != 0) {
        var e2 = 'validateSOAPResponse parse error: ' +serr;
        console.log('VALIDATESOPARESPONSE returning err:', err);
        return cb(e2);
      };
    } else {
      mj = json;

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
  });
};

// process multi part
var do1Part = function(part, cb) {
  // returns err, headers{}, payload(not encoded)
  var err = '';
  var headers = {};
  var payload = '';

/* example part
Content-Type: application/xop+xml;charset=utf-8;type="text/xml"
Content-Transfer-Encoding: 8bit
Content-ID: <2d42c5da-611c-4528-8c06-73c7ea9acdf0>

<?xml version="1.0" encoding="utf-8" ?>
....

DO1PART pa.length is  6
*/

  var pa = part.split("\r\n");
  var hdone = false;
  //console.log('DO1PART pa.length is ', pa.length);
  for (var i = 0; i < pa.length; i++) {
    var pal = pa[i];
    var pl = pal.length;
    //console.log('DOPART pal ' +i +' length' +pl +' ' +pal.substring(0, 50) + ' ' +hdone);
    if (pal.length < 1) {
	hdone = true;
	continue;
    };
    if (hdone == false) { //add the header
	var pah = pal.split(': ');
	var hn = pah[0];
	var hv = pah[1];
	if (hn && hv) {
	  headers[hn] = hv;
	};
    } else { // process content
	payload += pal;
	if (i != pa.length-1)
	  payload += "\r\n"; 
	else { 
          break;
	};
    };
  }; // end for
  payload = payload.substring(0, payload.length-1);
  return cb(err, headers, payload);
};

// process multi part
var doMulti = function(httpbody, httpheaders, cb) {
  // returns parallel arrays SOAPXML is 1st, file is second.
  // returns mperr, parts[], contents[], headers[]
  //console.log('DOMULTI:', httpbody.substring(0,100), httpheaders);
  var mperr, parts = [], contents = [], headers = [], respboundary;
  /* multiplart header example
    multipart/related;type="application/xop+xml";boundary="----=_Part_4685_444627190";start="<852d4dbe-6bcf-40cf-9e6a>";start-info="text/xml"
  */
  if (httpheaders && httpheaders['content-type']) {
    var ct = httpheaders['content-type'];
    if (ct.substring('multipart/related;')) {
      //console.log('MULTIPART:', httpheaders['content-type']);
      // find the boundary
      var mpa = ct.split(';');
      //console.log('BOUNDARY:', mpa[2]);
      for (var n = 0; n < mpa.length; n++) {
        var ctd = mpa[n];
        //console.log('MULTIPARTs:', ctd);
        var ctda = ctd.split('boundary="');
        if (ctda.length > 1) { // assuming this is the last one and is a file
          //console.log('BOUNDARY ARRAY:', ctda.length, ctda);
	  var rb = '--' +ctda[1];
	  var rb2 = rb.substring(0, rb.length-1);
	  respboundary = rb2;
	  // put the PART parsing here to minimize sync issues 
          var pc = 0;
          //console.log('MUTLI PART BOUNDARY is:', respboundary);
          var b1 = httpbody;
          var b2 = b1.split(respboundary +"\r\n");
          for (var i = 0; i < b2.length; i++) {
            var b3 = b2[i];
            if (b3.length < 1) continue;
            // returns mperr, parts[], contents[], headers[]

            var b3a = b3.split(respboundary);
            //console.log('B3A.LENGTH:' +b3a.length);
            if (b3a.length > 1) { // this is the last one and represents the file
              //console.log('  B3A[1]: ' +b3a[1]);
              b3b = b3a[0];
              b3 = b3b.substring(0, b3b.length-1);
            };
            parts[pc] = b3;
            // parse headers and content. prob should be another function
            // returns headers{}, payload(not encoded)
            do1Part(b3, function (err, hdrs, pyld){
                if (err) return cb(err);
                if (hdrs) {
                  //console.log('DOMULTI Part Headers ', hdrs);
                  headers[pc] = hdrs;
                };
                if (pyld) {
                  //console.log('DOMULTI Part Payload', pyld);
                  contents[pc] = pyld;
                  //contents[pc] = pyld.substring(0, pyld.length-1);
                  //if (pc === 1) return cb('', parts, contents, headers);
                };
            });

            pc++;
            //console.log('PART ' +pc +' ' +b3.length +'\n' +b3 +'END PART ' +pc);
          };
          //console.log('DOMULTI MULTIPART COUNT is ', pc);
          return cb('', parts, contents, headers);

        };
      };

    } else {
      //'multipart/related;'
      console.log('DOMULTI: returning null no "multipart/related" headers') 
      return cb('');
    }
  } else {
    console.log('DOMULTI: returning null no http headers') 
    return cb('');
  }
};


// generate json from the SOAP body
// small convenience method using xml2js
var soap2json = function(soapbody, cb) {
  var xml2js = require('xml2js');
  var po = { mergeAttrs: 'true' }; 

  //console.log('SOAP2JSON BODY:' +soapbody.substring(0, 100));
  var parser = new xml2js.Parser(po);
  parser.parseString(soapbody, function (err, json) {
    if (err) {
      var e2 = 'soap2json error: ' +err;
      //console.log('SOAP2JSON ERROR:' +err + ' ' +soapbody);
      return cb(e2, json);
    } else

    return cb(err, json);
  });
};

// recursive invocation simulating a for loop
function nextUpload(carr, prevargs) {
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
  //console.log('NEXTUPLOAD prevargs is ',  prevargs);

  if (prevargs.docid) argv2.push('docid='+prevargs.docid);
  if (prevargs.doctitle) argv2.push('doctitle='+prevargs.doctitle);

  //console.log('NEXTUPLOAD argv2 is ',  argv2);
  //console.log('nextUpload ENTRY:' +str);
  upload(argv2, function(er2, respcode2, jcfg2, stats2) {
    if (er2) {
      var estr = 'Request.cfgarr config=' +ccfg +' file=' +cfile +' ' +er2;
      console.log(estr);
      process.exit(1);
    } else {
      nextUpload(carr, argv2);
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

// Find the first document title that matches the name argument from the provided UCM Search ResultSet Response JSON object
// match arg detrmines is exact match is required
// return null or {"dDocTitle":name, "dID":value, "dOriginalName":value}
function findUCMDoc(rsjson, name, exact, cb) {
  //console.log('FINDUCMDOC entry: ', name, exact);
  var mr, nm, dID, dDocTitle;
  var rs = rsjson["env:Envelope"]["env:Body"][0]["ns2:GenericResponse"][0]["ns2:Service"][0]["ns2:Document"][0]["ns2:ResultSet"][2];
  var ra = rs["ns2:Row"];
  if (!ra)
    return cb('Doc not found for ' +name, retobj);
  var rc = ra.length;
  var match = false;
  //console.log("ResultSet Row Count is ", rc);
  var uname = name.toUpperCase();
  var retobj, dOriginalName, dID, dDocTitle;
  var match = false;
 
  for (var i = 0; i < ra.length; i++) {
    mr = ra[i];
    //console.log('FINDUCMDOC mr:', mr);
    nm = mr["ns2:Field"][0]["name"][0];
    dID = mr["ns2:Field"][0]["_"];
    dDocTitle = mr["ns2:Field"][1]["_"];
    dOriginalName = mr["ns2:Field"][9]["_"];
    //console.log('FINDUCMDOC Document:', i, nm, dID, dDocTitle);
    var utitle = dDocTitle.toUpperCase();
 
    if (exact == true) {
      if (utitle === uname) {
        match = true;
        break;
      };
    } else if (utitle.indexOf(uname) > -1) {
        match = true;
        break;
    };
  };
  //console.log('FINDUCMDOC match: ', match);

  if (match == true) {
    retobj = {};
    retobj.RowCount = rc;
    retobj.dDocTitle = dDocTitle;
    retobj.dID = dID;
    retobj.dOriginalName = dOriginalName;
    console.log('Found Document:', 'docid='+dID, 'doctitle='+dDocTitle);
  };

  return cb('', retobj);
};

// END INTERNAL ONLY FUNCTIONS

// BEGIN EXPORTED FUNCTIONS
// the majority of the work is done here uploading the file
var fileUpload = function(fn, cfg, args, cb) {
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
  var upperType = reqtype.toUpperCase();
  var req = cfg.request;
  var cfgarr = cfg.cfgarr;
  var respfile = args ? args.respfile : null;
  var searchfile = args ? args.searchfile : null;
  var respboundary;
  var respheaders = '';
  var docid = args.docid;
  var doctitle = args.doctitle;
  var mparts = [], mcontents = [], mheaders = [];

  cfg.file = filepath || cfg.filepath;
  maxsize ? maxsize : _DEFAULT_MAX_FILE_SIZE;

  //console.log('FILEUPLOAD: args:', args);
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
  // slither docid for UCM into cfg for %%DOCID%% substitution
  if (docid) cfg.docid = docid;
  if (searchfile) cfg.searchfile = searchfile;

  //console.log('UPERTYPE:', upperType);
  switch (upperType) {
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
    if (resp && resp.headers) respheaders = resp.headers; 

    if (error) {
	//console.log('fileupload.request.error is:' +error);
	return cb(error, response);
    }
    rc = response.statusCode;
    //console.log('FileUpload Response code is:' +rc);
    end = new Date();
    if (respfile && body) {
        //console.log('RESPONSE FILE:', respfile);
        var respdata = 'BEGIN HTTP HEADERS:\n' +JSON.stringify(respheaders) +'\nEND HTTP HEADERS\n';
	respdata += 'BEGIN CONTENT:\n' +body +'\nEND CONTENT';
        fs.writeFileSync(respfile, respdata);
    };
    if (rc == 200) {
	// save the response body
	  //var newbuf = new Buffer(body, 'binary');
	  //var wstream = fs.createWriteStream('body.bin');
	  //wstream.write(newbuf);
	  //wstream.end();

        // Print out the response body
        //console.log(req.body);
        //console.log('BODY:', body)
        // returns mperr, parts[], contents[], headers[]
	// returns parallel arrays SOAPXML is 1st, file is second.
	doMulti(body, respheaders, function(mperr, parts, contents, headers) {
          if (mperr) {
  	    var er = 'fileupload.mperr is:' +mperr;
  	    //console.log('fileupload.mperr is:' +er);
	    return cb(er, rc);
          }
	  if (parts.length > 0) {
	    mparts = parts;
	    //console.log('fileupload MULTIPART: mparts', mparts);
	    //console.log('fileupload MULTIPART: mparts.length ', mparts.length);
	  };
	  if (headers.length > 0) {
	    mheaders = headers;
	    //console.log('fileupload MULTIPART: mheaders ', mheaders.length, mheaders);
	  };
	  if (contents.length > 0) {
	    mcontents = contents;
	    //console.log('fileupload MULTIPART: mcontents length ', mcontents[0].length +' ' +mcontents[0].substring(0, 50));
	  };
	});

        // make a function for this dude!
        // UCM PUT or QUERY hack to parse out soap body from the raw response returned by UCM
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
	// code for UCM PUT and SEARCH. This really be part of the multipart impl above.
        var splitstr = 'env:Envelope';
        var bodyparts = body.split(splitstr);
	//console.log('bodyparts.length is ', bodyparts.length);
        var newbody;
        if (bodyparts.length >= 3) {
          var newbody = '<' +splitstr +bodyparts[1] +splitstr +'>';
          //console.log('REQUEST newbody:' +newbody);
          body = newbody.substring(0, newbody.length);
        };
        // END UCM

        validateSOAPResponse(body, function(verr) {
          if (verr) {
	    console.log(verr); 
	    myer = verr;
	   return cb(verr, rc);
          };
        });
    } else {
      myer = 'ERROR: fileUpload.request Response code of ' +rc +' is not 200' +"\n";;
      myer += body;
      //console.log(myer);
      return cb(myer, rc);
    }

    // convert body to json for return
    //console.log('FILEUPLOAD body:', body);
    soap2json(body, function(err, json) {
      //console.log('UPPERTYPE:', upperType);
      //console.log('JSON:', json);
      //console.log('ERR:', err);
      //if (!err && json) body = json;
      if (!err && json) {
        body = json;
        if (upperType === 'UCMSEARCH') {
	  if (!searchfile) return cb('required searchfile parameter not found');
          // parse our the response file to go get in the and put it in args
          var doc = findUCMDoc(json, searchfile, false, function(err2, doc) {
            if (err2) {
              var merr = 'FINDDOC err:' +searchfile +' ' +err2;
              console.log(merr);
              return cb(merr, rc);
            } else {
              //console.log('Doc is ', doc);
                /*
                Doc is  { RowCount: 5,
                dDocTitle: 'mft2hcm.js',
                dID: '659',
                dOriginalName: 'mft2hcm.js' }
                */
                // HOW TO HANDLE FILE NOT FOUND CASE. I guess return error for now
                if (doc.dID) {
                  args.ucmDoc = doc;
                  args.dID = doc.dID;
                  args.docid = doc.dID;
                  args.doctitle = doc.dDocTitle;
                } else { // return an error
                  var nofile = 'No match found for searchfile ' +searchfile;
                  return cb(nofile, rc);
                };
            };
          });
        } else if (upperType === 'UCMGET') {
	  //console.log('FILEUPLOAD UCMGET cfg:', cfg);
	  //console.log('FILEUPLOAD body:', body);

          if (mcontents.length < 2) {
            var nofile = 'No payload returned for docid ' +docid;
            return cb(nofile, rc);
	  }
	  // assuming multipart and mparts[], mheaders[], mcontents[]
          //console.log('Doc is ', doc);
	  // xml  payload is parts[0];
	  // file payload is parts[1];
	  /* headers returned
	  mheaders[0]
	    Content-Type: application/xop+xml;charset=utf-8;type="text/xml"
	    Content-Transfer-Encoding: 8bit
	    Content-ID: <7d7f2467-b003-45fd-97a3-3ed6367cee2d>
	  mheaders[1]
	    Content-Type: application/octet-stream
	    Content-Transfer-Encoding: binary
	  */
	  //console.log('MHEADERS:', mheaders);
	  var ctype1 = mheaders[0]['Content-Type'];
	  var ctype2 = mheaders[1]['Content-Type'];
	  //console.log('MHEADERS: Content-Types: ', ctype1, ctype2);

	  var isbin = outils.isBinary('', mcontents[1]);
	  var bo = 'utf8';
	  if (isbin) bo = 'binary';
	  //console.log('FILEUPLOAD UCMGET isbin:', isbin, bo);
	  console.log('Downloaded File ' , doctitle, ' is ', (isbin ? 'Binary' : 'TEXT'), bo);
	  //options = 'binary' 'utf8' 'base64' 'ascii' 'ucs2' 'hex'
	  var newbuf = new Buffer(mcontents[1], bo);
	  var wstream = fs.createWriteStream(doctitle);
	  wstream.write(newbuf);
	  wstream.end();
        };
      } else { // if (!err && json)
	// probably no json returned for non SOAP use case
	myerr = err;
	//console.log('ELSE ERROR:', myer);
	//console.log('ELSE ERROR:', err);
	//console.log('ELSE json:', json);
	}
    });
    if (!myer) {
      stats.filename = filename;
      stats.filepath = filepath
      stats.filesize = filesize;
      stats.summary = getStats(start, end, filename, filepath, filesize);
    };

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
  //console.log('GETREQUESTCONFI: argv is: ' +argv);
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
  //console.log('UPLOAD myargv: ', myargv);
  getRequestConfig(myargv, function(err, retargs, cfgfile, jcfg) {
    if (err) {
      //console.log(err);
      //console.trace(err);
      return cb(err);
    }
    args = retargs;
    filepath = args.file;

    jsoncfg = jcfg;
    //console.log('UPLOAD retargs: ', retargs);
    //console.log('UPLOAD args: ', args);

    fileUpload(filepath, jsoncfg, args, function(er, respcode, jsonbody, stats) {
      if (er) {
        var err = 'main.fileUpload error: ' +er;
        //console.log('UPLOAD ERROR: ' +er);
        //console.log('UPLOAD args: ', args);
        //console.trace('UPLOAD TRACE:', jsoncfg);
        return cb(er, respcode);
      } else {
        console.log('Response code is: ' +respcode);
        console.log(stats.summary);
        //console.log('dID:', args.dID);
        // support chaining of requests
        var cfgarr = jsoncfg.cfgarr;
        if (cfgarr && cfgarr.length > 0) {
	  //console.log('UPLOAD args: ', args);
	  //  [ { config: 'ucmget.json', file: 'UCM-PAYLOAD-GET' } ]
	  if (args.docid) cfgarr[0]['docid'] = args.docid; 
	  if (args.doctitle) cfgarr[0]['doctitle'] = args.doctitle; 
	  //console.log('UPLOAD next cfgarr: ', cfgarr);
          nextUpload(cfgarr, args);
        } else {
          return cb('', respcode, jsoncfg, stats);
        };
      };
    });
  });
};
module.exports.upload = upload;

// END EXPORTED FUNCTIONS

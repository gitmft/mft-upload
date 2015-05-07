var upload= require('../mft-upload');

// BEGIN MAIN
var filebody
var filepath;
var jsoncfg;
var args;
var reqOptions;

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
    var err = 'main.fileUpload error: ' +er;
    console.log(err);
    console.trace();
    process.exit(1);
  } else {
    //console.log('Main fileUpload call complete');
    console.log('Response code is: ' +respcode);
    //console.log(jsonbody);
    //console.log(util.inspect(jsonbody, false, null));
    console.log(stats.summary);
    return;
  };
});

process.on('uncaughtException', function(err) {
  // print the uncaught error and exit;
  console.log('uncaughtException:' +err);
  console.trace();
  process.exit(1);
});

// END MAIN

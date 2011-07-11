var http = require('http'),
    url = require('url');

http.createServer(function(request, response) {
  console.log("got request: " + request.headers['host'] + request_path(request));
  var emcee_request = http.request({
    host: process.env.EMCEE_HOST,
    path: request_path(request),
    port: parseInt(process.env.EMCEE_PORT),
    method: request.method,
    headers: request.headers });

  var deejay_request = http.request({
    host: process.env.DEEJAY_HOST,
    path: request_path(request),
    port: parseInt(process.env.DEEJAY_PORT),
    method: request.method,
    headers: request.headers });

  emcee_request.on('response', function(emcee_response) {
    emcee_response.on('data', function(chunk) { 
      response.write(chunk, 'binary'); 
      record_response("emcee", request.headers['host'] + request.url, emcee_response.statusCode, chunk.toString('binary')) });
    emcee_response.on('end', function() { response.end(); });
    response.writeHead(emcee_response.statusCode, emcee_response.headers);
  });

  deejay_request.on('response', function(deejay_response) {
    deejay_response.on('data', function(chunk) { 
      record_response("deejay", request.headers['host'] + request.url, deejay_response.statusCode, chunk.toString('utf8')) 
    });
  });

  request.on('data', function(chunk) {
    emcee_request.write(chunk, 'binary');
    deejay_request.write(chunk, 'binary');
  });
  request.on('end', function() {
    emcee_request.end();
    deejay_request.end();
  });
  request.on('close', function() {
    console.log("Connection terminated before expected");
  });
}).listen(80);

function request_path(request) {
  var parsed_url = url.parse(request.url)
  return parsed_url['search'] ? (parsed_url['pathname'] + parsed_url['search']) : parsed_url['pathname']
}

function record_response(type, url, code, body) {
  console.log(type + ":");
  console.log(url);
  console.log(code);
  console.log(body); 
}
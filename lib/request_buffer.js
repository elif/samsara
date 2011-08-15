exports.capture = function(request) {
  request.request_buffer = [];
  var data_handler = function(chunk) {
    request.request_buffer.push(['data', chunk]) }
  var end_handler = function() {
    request.request_buffer.push(['end', undefined]) }
  var close_handler = function() {
    request.request_buffer.push(['close', undefined]) }
  request.on('data', data_handler);
  request.on('end', end_handler);
  request.on('close', close_handler);
  request.buffer_listeners = { 
    data: data_handler, 
    end: end_handler,
    close: close_handler }
};

exports.replay = function(request) {
  ['data', 'end', 'close'].forEach(function(type) {
    request.removeListener(type, request.buffer_listeners[type]); });

  request.request_buffer.forEach(function(event) {
    switch(event[0]) {
    case 'data':
      request.emit(event[0], event[1]);
      break;
    default:
      request.emit(event[0]);
    }
  });
}
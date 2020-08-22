exports.imageQuality = {
  standard: {
    name: 'standard',
    resize: 1200,
    filetype: 'jpg',
    jpegQuality: 85
  },
  high: {
    name: 'high',
    resize: 2048,
    filetype: 'png',
    jpegQuality: 95
  },
  ridiculous: {
    name: 'ridiculous',
    resize: 4096,
    filetype: 'png',
    jpegQuality: 95
  }
}

exports.maxImageSize = {
  jpg: 10485760,
  gif: 5242880
}
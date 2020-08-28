const mongoose = require('mongoose');

const ObjectId = mongoose.Types.ObjectId;

const metascraper = require('metascraper')([
  require('metascraper-description')(),
  require('metascraper-image')(),
  require('metascraper-title')(),
  require('metascraper-url')(),
]);
const got = require('got');

const isObjectIdValid = (string) => {
  if (ObjectId.isValid(string)) {
    if (String(new ObjectId(string)) === string) {
      return true;
    }
  }
  return false;
}

const sendError = (status, message) => {
  return {
    error: {
      message,
      status,
    },
  };
};

const sendResponse = (data, status, message) => {
  return {
    data,
    message,
    status,
  };
};

const scrapeURL = async (req, res) => {
  // Remove any variant of (http(s):)// from the string and add 'http://' so got
  // and the JS URL library will always be able to follow the URL
  const inputURL = `http://${req.body.url.replace(/^(http(s)*)*:*\/\//gi, '')}`;
  const { body: html, url } = await got(inputURL).catch((error) => res.status(500).send(sendError(500, `There has been a problem processing this URL: ${error}`)));
  const metadata = await metascraper({ html, url });
  if (!metadata) {
    return res.status(404).send(sendError(404, 'Metadata for this URL is not available'));
  }
  const domain = new URL(inputURL).hostname.replace('www.', '');
  /**
   * Check if the URL is a YouTube or Vimeo URL - in which case create a playable embed link for it
   */
  // Taken from https://stackoverflow.com/questions/19377262/regex-for-youtube-url
  const youtubeUrlFindingRegex = /^((?:https?:)?\/\/)?((?:www|m)\.)?((?:youtube\.com|youtu.be))(\/(?:[\w\-]+\?v=|embed\/|v\/)?)([\w\-]+)(\S+)?$/;
  // Taken from https://github.com/regexhq/vimeo-regex/blob/master/index.js
  const vimeoUrlFindingRegex = /^(http|https)?:\/\/(www\.)?vimeo.com\/(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|)(\d+)(?:|\/\?)$/;
  let embedUrl;
  let regexParsedURL;
  if ((regexParsedURL = youtubeUrlFindingRegex.exec(metadata.url))) {
    embedUrl = 'https://www.youtube.com/embed/' + regexParsedURL[5] + '?autoplay=1';
    try {
      const time = /t=(?:([0-9]*)m)?((?:[0-9])*)(?:s)?/.exec(regexParsedURL[6]);
      if (time) {
        let seconds = 0
        if (time[2]) {
          seconds += parseInt(time[2]);
        }
        if (time[1]) {
          seconds += (parseInt(time[1]) * 60);
        }
        if (seconds) {
          embedUrl += `&start=${seconds}`;
        }
      }
    } catch (err) { // catch potential parseInt errors
      console.log('YouTube link had time specifier that was apparently malformed! Error:');
      console.log(err);
    }
  } else if ((regexParsedURL = vimeoUrlFindingRegex.exec(finalUrl))) {
    embedUrl = 'https://player.vimeo.com/video/' + regexParsedURL[4] + '?autoplay=1';
  }
  console.log(embedUrl);
  return res.status(200).send(sendResponse({ ...metadata, domain, embedUrl }, 200));
}

module.exports = {
  isObjectIdValid,
  sendError,
  sendResponse,
  scrapeURL,
};

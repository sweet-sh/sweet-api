const Autolinker = require('autolinker');
const sanitizeHtml = require('sanitize-html');

const sanitizeHTML = (html) => {
  return sanitizeHtml(html, {
    allowedTags: ['blockquote', 'ul', 'li', 'em', 'i', 'b', 'strong', 'a', 'p', 'br'],
    allowedAttributes: {
      a: ['href', 'target', 'class']
    },
    allowedClasses: {
      a: ['sweet-tag-link', 'sweet-community-link', 'sweet-user-link']
    },
    transformTags: {
      a: (tagName, attribs) => {
        console.log(attribs.href)
        // If a link is not explicitly relative due to an initial / (like mention and hashtag links are) and doesn't already include a protocol:
        if (attribs.href.substring(0, 1) !== '/' && !attribs.href.includes('//')) {
          // Make the link explicitly non-relative
          attribs.href = 'http://' + attribs.href
        }
        // Add helper classes to local links (starting with /)
        if (attribs.href.substring(0, 1) === '/') {
          if (attribs.href.startsWith('/tag')) {
            attribs.class = 'sweet-tag-link'
          } else if (attribs.href.startsWith('/community')) {
            attribs.class = 'sweet-community-link'
          } else {
            attribs.class = 'sweet-user-link'
          }
        }
        attribs.target = '_blank'
        return {
          tagName: 'a',
          attribs: attribs
        }
      }
    }
  })
}

const parseText = (rawText, mentionsEnabled = true, hashtagsEnabled = true, urlsEnabled = true) => {
  console.log('Parsing content')
  splitText = rawText.split(/\r\n|\r|\n/gi).map(line => line = "<p>" + line + "</p>").filter(line => line !== '<p></p>')
  let lineCount = splitText.length
  rawText = splitText.join('')
  // rawText = rawText.replace(/(<p><\/p>)/g, '') // filter out blank lines

  const mentionRegex = /(^|[^@\w])@([\w-]{1,30})[\b-]*/g
  const mentionReplace = '$1<a href="/$2">@$2</a>'
  const hashtagRegex = /(^|>|\n|\ |\t)#(\w{1,60})\b/g
  const hashtagReplace = '$1<a href="/tag/$2">#$2</a>'

  if (urlsEnabled) {
    rawText = Autolinker.link(rawText)
  }
  if (mentionsEnabled) {
    rawText = rawText.replace(mentionRegex, mentionReplace)
  }
  if (hashtagsEnabled) {
    rawText = rawText.replace(hashtagRegex, hashtagReplace)
  }

  rawText = sanitizeHTML(rawText)

  const mentionsArray = Array.from(new Set(rawText.replace(/<[^>]*>/g, ' ').match(mentionRegex)))
  const tagsArray = Array.from(new Set(rawText.replace(/<[^>]*>/g, ' ').match(hashtagRegex)))
  const trimmedMentions = []
  const trimmedTags = []
  if (mentionsArray) {
    mentionsArray.forEach((el) => {
      trimmedMentions.push(el.replace(/(@|\s)*/i, ''))
    })
  }
  if (tagsArray) {
    tagsArray.forEach((el) => {
      trimmedTags.push(el.replace(/(#|\s)*/i, ''))
    })
  }

  const parsedPost = {
    text: rawText,
    array: splitText,
    mentions: trimmedMentions,
    tags: trimmedTags
  }
  return parsedPost
}

module.exports = {
  parseText,
}

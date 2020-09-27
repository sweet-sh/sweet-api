/* eslint-disable func-style */
const hbs = require('./pageRenderer');
const mongoose = require('mongoose');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;
const { DOMParser } = require('prosemirror-model');
const sanitizeHtml = require('sanitize-html');
const schema = require('./schema');
const configDatabase = require('../src/config/database').config;
const Post = require('../src/modules/post/model');
const User = require('../src/modules/user/model');
mongoose.connect(configDatabase.url, { useNewUrlParser: true });

const parser = DOMParser.fromSchema(schema.schema);

const renderHTMLContent = async (postOrComment, forEditor = false) => {
  const cleanedParsedContent = sanitizeHtml(postOrComment.parsedContent, {
    allowedTags: false,
    allowedAttributes: false,
    exclusiveFilter(frame) {
      return frame.tag === 'a' && frame.attribs.class === 'show-more';
    },
  });
  console.log(cleanedParsedContent);
  let filenames;
  let html;
  if (postOrComment.inlineElements && postOrComment.inlineElements.length) {
    const lines = []; // they're more like paragraphs, really
    const lineFinder = /(<p>.*?<\/p>)|(<ul>.*?<\/ul>)|(<blockquote>.*?<\/blockquote>)/g;
    let line;
    while ((line = lineFinder.exec(cleanedParsedContent))) {
      lines.push(line[0]);
    }
    let addedLines = 0;
    for (const il of postOrComment.inlineElements) {
      if (il.type === 'link-preview') {
        if (il.isEmbeddableVideo) {
          console.log('embed!!!!');
          il.type = 'video'; // the template looks for "video" in this field, like what older posts with embeds have
        }
        html = await hbs.render('./embed.handlebars', il);
        il.type = 'link-preview'; // yes, this is dumb. the alternative is to list all the different variables the template expects in the rendering options with type: (isEmbeddableVideo ? "video" : "asdj;lfkfdsajkfl;") or something
      } else if (il.type === 'image(s)') {
        il.contentWarnings = postOrComment.contentWarnings;
        il.author = {
          username: (await User.findById(postOrComment.author, { username: 1 }))
            .username,
        };
        filenames = il.images;
        il.images = il.images.map((v) => '/api/image/display/' + v);
        html = await hbs.render('./imagegallery.handlebars', il);
        il.images = filenames; // yes, this is dumb. the alternative is to specify each variable the template expects individually in the rendering options with like images: fullImagePaths
      }
      lines.splice(il.position + addedLines, 0, html);
      addedLines++;
    }
    return lines.join('');
  } else if (
    (postOrComment.images && postOrComment.images.length) ||
    (postOrComment.embeds && postOrComment.embeds.length)
  ) {
    let endHTML = '';
    if (postOrComment.embeds && postOrComment.embeds.length) {
      // this is a post from before the inlineElements array, render its embed (mandated to be just one) and put it at the end of html
      endHTML += await hbs.render(
        './embed.handlebars',
        postOrComment.embeds[0],
      );
    }
    if (postOrComment.images && postOrComment.images.length) {
      const imageUrlPrefix =
        'https://sweet-images.s3.eu-west-2.amazonaws.com/images/';
      // this is a post or comment from before the inlineElements array, render its images (with determined full urls) with the parallel arrays and put that at the end of html
      filenames = postOrComment.images;
      postOrComment.images = postOrComment.images.map(
        (v) => imageUrlPrefix + v,
      );
      endHTML += await hbs.render('./imagegallery.handlebars', postOrComment);
      postOrComment.images = filenames; // yes, this is dumb
    }
    return cleanedParsedContent + endHTML;
  } else {
    return cleanedParsedContent;
  }
};

const parseHTMLBody = (input) => {
  const { document } = new JSDOM(input).window;
  const parsedHTML = parser
    .parse(document, { preserveWhitespace: true })
    .toJSON();
  return parsedHTML;
};

const keepCachedHTMLUpToDate = async (post) => {
  async function updateHTMLRecursive(displayContext) {
    console.log('Updating HTML for post', displayContext._id);
    // First convert old HTML into new HTML
    displayContext.htmlBody = await renderHTMLContent(displayContext);
    // Now convert new HTML into JSON
    const parsedPost = parseHTMLBody(displayContext.htmlBody);
    displayContext.jsonBody = parsedPost;
    if (displayContext.comments) {
      for (const comment of displayContext.comments) {
        console.log('Updating HTML for comment', comment._id);
        await updateHTMLRecursive(comment);
      }
    } else if (displayContext.replies) {
      for (const reply of displayContext.replies) {
        console.log('Updating HTML for reply', reply._id);
        await updateHTMLRecursive(reply);
      }
    }
  }
  await updateHTMLRecursive(post);
  await post.save();
  return post;
};

async function asyncForEach(array, callback) {
  for (let index = 0; index < array.length; index++) {
    await callback(array[index], index, array);
  }
}

const convertPosts = () => {
  Post.find({}).then((response) => {
    const start = async () => {
      await asyncForEach(response, async (post) => {
        console.log('================================================');
        console.log('Processing post', post._id);
        await keepCachedHTMLUpToDate(post);
        console.log('Processed!');
      });
      console.log('Done!');
    };
    start();
  });
};

convertPosts();

const { Schema } = require('prosemirror-model');

const schema = new Schema({
  nodes: {
    doc: {
      content: 'block+',
    },
    text: {
      group: 'inline',
    },
    paragraph: {
      content: 'inline*',
      group: 'block',
      draggable: false,
      parseDOM: [{ tag: 'p' }],
    },
    blockquote: {
      content: 'block*',
      group: 'block',
      defining: true,
      draggable: false,
      parseDOM: [{ tag: 'blockquote' }],
    },
    bullet_list: {
      content: 'list_item+',
      group: 'block',
    },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      draggable: false,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    },
    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
    },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      draggable: false,
      parseDOM: [{ tag: 'li' }],
    },
    ordered_list: {
      attrs: { order: { default: 1 } },
      content: 'list_item+',
      group: 'block',
      parseDOM: [{ tag: 'ol' }],
    },
    mention: {
      attrs: {
        label: { default: null },
      },
      group: 'inline',
      inline: true,
      selectable: false,
      atom: true,
      parseDOM: [
        {
          priority: 60,
          tag: 'a.mention-link',
          getAttrs(dom) {
            let label = dom.getAttribute('href');
            while (label.charAt(0) === '/') {
              label = label.substring(1);
            }
            return {
              label,
            };
          },
        },
      ],
    },
    sweet_link_preview: {
      group: 'block',
      attrs: {
        url: { default: null },
        embedUrl: { default: null },
        title: { default: null },
        description: { default: null },
        image: { default: null },
        domain: { default: null },
      },
      parseDOM: [
        {
          priority: 70,
          tag: 'a.link-preview-container',
          getAttrs(dom) {
            const url = dom.getAttribute('href');
            const embedUrl = dom.getAttribute('embedurl');
            const title = dom.querySelector('.link-preview-title').innerHTML;
            const description = dom.querySelector('.link-preview-description')
              .innerHTML;
            const image = dom.querySelector('img') ? dom.querySelector('img').getAttribute('src') : null;
            const domain = dom.querySelector('.link-preview-domain').innerHTML;
            return {
              url,
              embedUrl,
              title,
              description,
              image,
              domain,
            };
          },
        },
      ],
    },
    image: {
      attrs: {
        src: {},
        alt: { default: null },
      },
      parseDOM: [
        {
          priority: 40,
          tag: 'img[src]',
          getAttrs(dom) {
            return {
              src: dom.getAttribute('src'),
              alt: dom.getAttribute('alt'),
            };
          },
        },
      ],
    },
    gallery: {
      group: 'block',
      content: 'image*',
      parseDOM: [{ tag: 'div.post-images', priority: 40 }],
      draggable: true,
    },
  },
  marks: {
    link: {
      attrs: {
        href: {},
      },
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs(dom) {
            return { href: dom.getAttribute('href') };
          },
        },
      ],
      inclusive: false,
    },
    bold: {
      parseDOM: [
        { tag: 'strong' },
        // This works around a Google Docs misbehavior where
        // pasted content will be inexplicably wrapped in `<b>`
        // tags with a font-weight normal.
        {
          tag: 'b',
          getAttrs: (node) => node.style.fontWeight != 'normal' && null,
        },
        {
          style: 'font-weight',
          getAttrs: (value) => /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null,
        },
      ],
    },
    code: {
      excludes: '_',
      parseDOM: [{ tag: 'code' }],
    },
    italic: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
    },
  },
});

module.exports = {
  schema,
};

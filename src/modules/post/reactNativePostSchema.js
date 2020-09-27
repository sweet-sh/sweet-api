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
      toDOM() {
        return ['p', 0];
      },
    },
    blockquote: {
      content: 'block*',
      group: 'block',
      defining: true,
      draggable: false,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM() {
        return ['blockquote', 0];
      },
    },
    bullet_list: {
      content: 'list_item+',
      group: 'block',
      toDOM() {
        return ['ul', 0];
      },
    },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      draggable: false,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM() {
        return ['pre', ['code', 0]];
      },
    },
    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM() {
        return ['hr'];
      },
    },
    list_item: {
      content: 'paragraph block*',
      defining: true,
      draggable: false,
      parseDOM: [{ tag: 'li' }],
      toDOM() {
        return ['li', 0];
      },
    },
    ordered_list: {
      attrs: { order: { default: 1 } },
      content: 'list_item+',
      group: 'block',
      parseDOM: [{ tag: 'ol' }],
      toDOM() {
        return ['ol', 0];
      },
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
      toDOM: (node) => [
        'a',
        {
          href: '/' + node.attrs.label,
          class: 'mention-link',
        },
        '@' + node.attrs.label,
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
            const embedUrl = dom.getAttribute('data-embed-url');
            const title = dom.querySelector('.link-preview-title').innerHTML;
            const description = dom.querySelector('.link-preview-description')
              .innerHTML;
            const image = dom.querySelector('img').getAttribute('src') || null;
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
      toDOM: (node) => [
        'link-preview-container',
        {
          url: node.attrs.url,
          embedUrl: node.attrs.embedUrl,
          title: node.attrs.title,
          description: node.attrs.description,
          image: node.attrs.image,
          domain: node.attrs.domain,
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
      toDOM: (node) => [
        'image',
        {
          src: node.attrs.src.startsWith('/api/image/display') ? node.attrs.src : ('/api/image/display/' + node.attrs.src.replace('images/', '')),
          alt: node.attrs.alt,
        },
      ],
    },
    gallery: {
      group: 'block',
      parseDOM: [{ tag: 'div.post-images', priority: 40 }],
      toDOM(node) {
        const childNodes = [];
        node.content.forEach((o) => {
          o.attrs.src = o.attrs.src.split('/').pop();
          childNodes.push(o.attrs);
        });
        return ['gallery', {
          images: JSON.stringify(childNodes),
        }];
      },
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
      toDOM(node) {
        const { href, target } = node.attrs;
        return [
          'a',
          { href, rel: 'noopener noreferrer nofollow', target: '_blank' },
          0,
        ];
      },
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
      toDOM() {
        return ['strong', 0];
      },
    },
    code: {
      excludes: '_',
      parseDOM: [{ tag: 'code' }],
      toDOM() {
        return ['code', 0];
      },
    },
    italic: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM() {
        return ['em', 0];
      },
    },
    underline: {
      toDOM() {
        return ['u', 0];
      },
    },
  },
});

module.exports = {
  schema,
};